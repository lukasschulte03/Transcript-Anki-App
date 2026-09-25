import * as Dialog from "@radix-ui/react-dialog";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  AudioLines,
  Check,
  ChevronRight,
  Cloud,
  Database,
  FolderOpen,
  History,
  LoaderCircle,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  SwatchBook,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  LectioClient,
  LectioResult,
  LibraryBackupSummary,
  LibraryTransferProgress,
} from "../../application/lectioClient";
import { useLibrary, useSettings } from "../shared/useLectioClient";
import {
  NextButton,
  NextEmptyState,
  NextSection,
  NextSettingRow,
  NextSurface,
} from "./ui/NextPrimitives";
import {
  SettingsPanel,
  type SettingsCategoryId,
} from "./settings/SettingsPanels";
import "./settings.css";

type CategoryId = "library" | SettingsCategoryId;
const categories: Array<{
  id: CategoryId;
  title: string;
  icon: typeof Database;
  keywords: string;
}> = [
  {
    id: "library",
    title: "Bibliotek och data",
    icon: Database,
    keywords: "importera exportera zip json backup återställ lagring",
  },
  {
    id: "appearance",
    title: "Utseende",
    icon: SwatchBook,
    keywords: "språk svenska english tema färg gränssnitt",
  },
  {
    id: "audio",
    title: "Ljud och inspelning",
    icon: AudioLines,
    keywords: "mikrofon ljud kvalitet inspelning enhet",
  },
  {
    id: "transcription",
    title: "Transkribering",
    icon: Settings2,
    keywords: "whisper modell nvidia cpu groq openai api fraslexikon",
  },
  {
    id: "ai-anki",
    title: "AI och Anki",
    icon: Sparkles,
    keywords: "anki ankiconnect kort api nyckel provider modell copy paste",
  },
  {
    id: "sync",
    title: "Synk och anslutningar",
    icon: Cloud,
    keywords: "google drive moln oauth synka konto mapp",
  },
];
const searchable = {
  files:
    "importera exportera bibliotek zip json filer säkerhetskopia ljud slides pdf",
  backups:
    "återställningspunkter säkerhet backup kopia historik behåll antal återställ",
};
const date = (value: string) =>
  new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export function StudySettings({
  client,
  onBusyChange,
}: {
  client: LectioClient;
  onBusyChange: (busy: boolean) => void;
}) {
  const library = useLibrary(client);
  const settings = useSettings(client);
  const [activeCategory, setActiveCategory] = useState<CategoryId>("library");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [progress, setProgress] = useState<LibraryTransferProgress | null>(
    null,
  );
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(
    null,
  );
  const [backups, setBackups] = useState<LibraryBackupSummary[]>([]);
  const [backupsError, setBackupsError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [pending, setPending] = useState<
    { file: File } | { backup: LibraryBackupSummary } | null
  >(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("sv-SE");
  const matches = (text: string) =>
    !normalizedQuery || text.includes(normalizedQuery);
  const filesVisible = matches(searchable.files);
  const backupsVisible = matches(searchable.backups);
  const isolated = client.runtime.dataProfile === "next";
  const categoryMatches = categories.filter((category) =>
    `${category.title} ${category.keywords}`
      .toLocaleLowerCase("sv-SE")
      .includes(normalizedQuery),
  );

  const updateSettings = (patch: Partial<typeof settings>) => {
    const result = client.settings.update(patch);
    if (!result.ok) setNotice({ error: true, text: result.error.message });
  };

  const refreshBackups = async () => {
    const result = await client.workflows.listBackups();
    if (result.ok) {
      setBackups(result.value);
      setBackupsError("");
    } else setBackupsError(result.error.message);
  };
  useEffect(() => {
    let active = true;
    void client.workflows.listBackups().then((result) => {
      if (!active) return;
      if (result.ok) {
        setBackups(result.value);
        setBackupsError("");
      } else setBackupsError(result.error.message);
    });
    return () => {
      active = false;
    };
  }, [client]); // data is loaded only when this screen opens
  useEffect(() => {
    if (!busy) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [busy]);

  const run = async (
    label: string,
    action: () => Promise<LectioResult<unknown>>,
    success: string,
  ) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    onBusyChange(true);
    setNotice(null);
    setProgress({ completed: 0, detail: label });
    try {
      const result = await action();
      setNotice({
        error: !result.ok,
        text: result.ok ? success : result.error.message,
      });
      if (result.ok) await refreshBackups();
    } catch {
      setNotice({
        error: true,
        text: "Åtgärden kunde inte slutföras. Försök igen.",
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
      onBusyChange(false);
      setProgress(null);
    }
  };
  const confirmTransfer = () => {
    if (!pending) return;
    const value = pending;
    setPending(null);
    if ("file" in value)
      void run(
        "Förbereder import…",
        () =>
          client.workflows.importLibraryFile(
            value.file,
            value.file.name,
            setProgress,
          ),
        "Biblioteket har importerats. Du hittar det i sidofältet.",
      );
    else
      void run(
        "Återställer biblioteket…",
        () => client.workflows.restoreBackup(value.backup.id),
        "Biblioteket har återställts.",
      );
  };

  return (
    <section className="study-settings" aria-label="Inställningar">
      <header className="study-settings-header">
        <div>
          <h1>Inställningar</h1>
        </div>
        <label className="study-settings-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            placeholder="Sök inställningar"
            aria-label="Sök inställningar"
            value={query}
            onChange={(event) => {
              const value = event.target.value;
              setQuery(value);
              const normalized = value.trim().toLocaleLowerCase("sv-SE");
              if (!normalized) return;
              const match = categories.find((category) =>
                `${category.title} ${category.keywords}`
                  .toLocaleLowerCase("sv-SE")
                  .includes(normalized),
              );
              if (match) setActiveCategory(match.id);
            }}
          />
        </label>
      </header>
      <div className="study-settings-layout">
        <nav className="study-settings-nav" aria-label="Inställningskategorier">
          {categories.map(({ id, title, icon: Icon }) => (
            <NextButton
              key={id}
              tone="quiet"
              aria-current={activeCategory === id ? "page" : undefined}
              onClick={() => {
                setActiveCategory(id);
                setQuery("");
              }}
            >
              <Icon aria-hidden="true" />
              <span>{title}</span>
              {activeCategory === id && <ChevronRight aria-hidden="true" />}
            </NextButton>
          ))}
        </nav>
        <div className="study-settings-scroll">
          <div className="study-settings-content">
            {activeCategory === "library" && (
              <>
                <NextSurface className="study-settings-intro" tone="subtle">
                  <div className="study-settings-emblem" aria-hidden="true">
                    <Database />
                  </div>
                  <h2>Bibliotek och data</h2>
                  <p>
                    En trygg plats för dina studier. Ta med dem dit du vill.
                  </p>
                </NextSurface>
                <NextSurface
                  className="study-library-summary"
                  tone="subtle"
                  aria-label="Ditt bibliotek"
                >
                  {[
                    {
                      label: "kurser",
                      count: library.nodes.filter(
                        (node) => node.type === "course",
                      ).length,
                    },
                    {
                      label: "föreläsningar",
                      count: library.nodes.filter(
                        (node) => node.type === "lecture",
                      ).length,
                    },
                    { label: "Anki-kort", count: library.cards.length },
                  ].map(({ label, count }) => (
                    <span key={label}>
                      <strong>{count.toLocaleString("sv-SE")}</strong>
                      {label}
                    </span>
                  ))}
                  <span className="study-library-local">
                    <ShieldCheck aria-hidden="true" />
                    {isolated ? "Separat testbibliotek" : "Lagras lokalt"}
                  </span>
                </NextSurface>
                {isolated && (
                  <p className="study-settings-profile">
                    Det här är nya Lectios eget bibliotek. Importera en export
                    för att komma igång — originalet i den vanliga appen
                    påverkas inte.
                  </p>
                )}
                {filesVisible && (
                  <NextSection
                    className="study-settings-group"
                    title="Flytta ditt bibliotek"
                  >
                    <NextSettingRow
                      icon={<ArrowDownToLine />}
                      title="Importera bibliotek"
                      description="Läs in en Lectio-export. ZIP tar med ljud, PDF:er och bilder; JSON innehåller bara biblioteksdata."
                    >
                      <NextButton
                        className="study-settings-button study-settings-button-primary"
                        tone="primary"
                        disabled={busy}
                        onClick={() => fileInput.current?.click()}
                      >
                        <FolderOpen />
                        Välj fil
                      </NextButton>
                      <input
                        hidden
                        ref={fileInput}
                        type="file"
                        accept=".zip,.json,application/zip,application/json"
                        aria-label="Välj biblioteksexport"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) setPending({ file });
                          event.target.value = "";
                        }}
                      />
                    </NextSettingRow>
                    <NextSettingRow
                      icon={<ArrowUpFromLine />}
                      title="Exportera bibliotek"
                      description="Spara hela biblioteket och dess media i en ZIP-fil. Dina API-nycklar och kontoinställningar följer inte med."
                    >
                      <NextButton
                        className="study-settings-button"
                        disabled={busy || library.nodes.length === 0}
                        onClick={() =>
                          void run(
                            "Förbereder export…",
                            () => client.workflows.exportLibrary(setProgress),
                            "ZIP-exporten har skickats till dina nedladdningar.",
                          )
                        }
                      >
                        <ArrowUpFromLine />
                        Exportera
                      </NextButton>
                    </NextSettingRow>
                  </NextSection>
                )}
                {backupsVisible && (
                  <NextSection
                    className="study-settings-group"
                    title="Ett steg tillbaka, om det behövs"
                  >
                    <NextSettingRow
                      icon={<History />}
                      title="Lokala återställningspunkter"
                      description="Sparar bibliotekets struktur och innehåll med referenser till dina mediafiler. Använd ZIP-export för en fullständig säkerhetskopia."
                    >
                      <NextButton
                        className="study-settings-button"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            "Sparar återställningspunkt…",
                            () => client.workflows.createBackup(),
                            "Återställningspunkten har sparats.",
                          )
                        }
                      >
                        <Archive />
                        Spara nu
                      </NextButton>
                    </NextSettingRow>
                    <NextSettingRow
                      icon={<ShieldCheck />}
                      title="Antal att behålla"
                      description="När en ny punkt sparas rensas de äldsta automatiskt."
                    >
                      <div
                        className="study-segmented"
                        role="group"
                        aria-label="Antal återställningspunkter"
                      >
                        {[5, 10, 20].map((limit) => (
                          <button
                            key={limit}
                            disabled={busy}
                            aria-pressed={settings.backupLimit === limit}
                            onClick={() => {
                              const result = client.settings.update({
                                backupLimit: limit,
                              });
                              if (!result.ok)
                                setNotice({
                                  error: true,
                                  text: result.error.message,
                                });
                            }}
                          >
                            {limit}
                          </button>
                        ))}
                      </div>
                    </NextSettingRow>
                    <NextButton
                      className="study-history-toggle"
                      tone="quiet"
                      disabled={busy}
                      aria-expanded={showHistory}
                      aria-controls="study-backup-history"
                      onClick={() => setShowHistory(!showHistory)}
                    >
                      <History />
                      <span>
                        {backups.length
                          ? `${backups.length} sparade återställningspunkter`
                          : "Inga återställningspunkter än"}
                      </span>
                      <ChevronRight data-open={showHistory} />
                    </NextButton>
                    {backupsError && (
                      <p className="study-settings-error" role="alert">
                        {backupsError}
                      </p>
                    )}
                    {showHistory && (
                      <div
                        id="study-backup-history"
                        className="study-backup-history"
                      >
                        {backups.length === 0 ? (
                          <p>
                            Spara en punkt ovanför för att kunna gå tillbaka
                            senare.
                          </p>
                        ) : (
                          backups.map((backup) => (
                            <div className="study-backup-item" key={backup.id}>
                              <div>
                                <time dateTime={backup.createdAt}>
                                  {date(backup.createdAt)}
                                </time>
                                <span>{backup.nodes} biblioteksobjekt</span>
                              </div>
                              <NextButton
                                className="study-settings-button"
                                disabled={busy}
                                onClick={() => setPending({ backup })}
                              >
                                Återställ
                              </NextButton>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </NextSection>
                )}
                {!filesVisible && !backupsVisible && (
                  <NextEmptyState
                    className="study-settings-empty"
                    icon={<Search />}
                    title="Inga matchande inställningar"
                    description="Prova exempelvis ”import” eller ”backup”."
                    action={
                      <NextButton
                        className="study-settings-button"
                        onClick={() => setQuery("")}
                      >
                        Visa alla
                      </NextButton>
                    }
                  />
                )}
              </>
            )}
            {activeCategory !== "library" && categoryMatches.length > 0 && (
              <SettingsPanel
                category={activeCategory}
                client={client}
                settings={settings}
                update={updateSettings}
                onNotice={(text, error = false) => setNotice({ text, error })}
              />
            )}
            {activeCategory !== "library" &&
              normalizedQuery &&
              categoryMatches.length === 0 && (
                <NextEmptyState
                  className="study-settings-empty"
                  icon={<Search />}
                  title="Inga matchande inställningar"
                  description="Prova exempelvis ”mikrofon”, ”Whisper”, ”Anki” eller ”Drive”."
                  action={
                    <NextButton onClick={() => setQuery("")}>
                      Visa alla
                    </NextButton>
                  }
                />
              )}
            {progress && (
              <div className="study-transfer-status" role="status">
                <LoaderCircle className="study-spin" />
                <div>
                  <span>{progress.detail}</span>
                  <progress
                    aria-label="Biblioteksöverföring"
                    value={progress.total ? progress.completed : undefined}
                    max={progress.total ?? 1}
                  />
                  <small>
                    Bibliotekets ändringar är pausade under överföringen.
                  </small>
                </div>
              </div>
            )}
            {notice && (
              <div
                className="study-settings-notice"
                data-error={notice.error}
                role={notice.error ? "alert" : "status"}
              >
                {notice.error ? <X /> : <Check />}
                <span>{notice.text}</span>
                <NextButton
                  aria-label="Stäng meddelandet"
                  tone="quiet"
                  onClick={() => setNotice(null)}
                >
                  <X />
                </NextButton>
              </div>
            )}
          </div>
        </div>
      </div>
      <Dialog.Root
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="study-settings-overlay" />
          <Dialog.Content className="study-settings-dialog">
            <Dialog.Title>
              {pending && "file" in pending
                ? "Importera bibliotek?"
                : "Återställa biblioteket?"}
            </Dialog.Title>
            <Dialog.Description>
              Det nuvarande biblioteket i den här profilen ersätts. En lokal
              återställningspunkt sparas först. Dina inställningar och andra
              Lectio-profiler ändras inte.
            </Dialog.Description>
            {pending && (
              <p className="study-confirm-file">
                {"file" in pending
                  ? pending.file.name
                  : date(pending.backup.createdAt)}
              </p>
            )}
            <div>
              <Dialog.Close asChild>
                <NextButton className="study-settings-button">
                  Avbryt
                </NextButton>
              </Dialog.Close>
              <NextButton
                className="study-settings-button study-settings-button-primary"
                tone="primary"
                onClick={confirmTransfer}
              >
                {pending && "file" in pending ? "Importera" : "Återställ"}
              </NextButton>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
