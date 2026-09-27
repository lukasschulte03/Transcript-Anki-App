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
  Image as ImageIcon,
  Languages,
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
import {
  searchSettings,
  type SettingsSearchEntry,
} from "./settings/settingsSearch";
import "./settings.css";

type CategoryId = "library" | SettingsCategoryId;
const categories: Array<{
  id: CategoryId;
  title: string;
  icon: typeof Database;
}> = [
  {
    id: "library",
    title: "Bibliotek och data",
    icon: Database,
  },
  {
    id: "general",
    title: "Allmänt",
    icon: Languages,
  },
  {
    id: "appearance",
    title: "Utseende",
    icon: SwatchBook,
  },
  {
    id: "audio",
    title: "Ljud och inspelning",
    icon: AudioLines,
  },
  {
    id: "transcription",
    title: "Transkribering",
    icon: Settings2,
  },
  {
    id: "image-analysis",
    title: "OCR och bildanalys",
    icon: ImageIcon,
  },
  {
    id: "ai-anki",
    title: "AI och Anki",
    icon: Sparkles,
  },
  {
    id: "sync",
    title: "Synk och anslutningar",
    icon: Cloud,
  },
];
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
  const [searchTarget, setSearchTarget] = useState<{
    target: string;
    fallbackTarget?: string;
  } | null>(null);
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
  const normalizedQuery = query.trim();
  const searchResults = searchSettings(normalizedQuery);

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
    if (!searchTarget) return;
    const frame = requestAnimationFrame(() => {
      const target =
        document.getElementById(searchTarget.target) ??
        document.getElementById(searchTarget.fallbackTarget ?? "");
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeCategory, searchTarget]);
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
  const chooseSearchResult = (entry: SettingsSearchEntry) => {
    setActiveCategory(entry.category);
    setQuery("");
    setSearchTarget({
      target: entry.target,
      fallbackTarget: entry.fallbackTarget,
    });
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
            name="settings-search"
            autoComplete="off"
            placeholder="Sök inställningar"
            aria-label="Sök inställningar"
            aria-controls="study-settings-search-results"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
              if (event.key === "Enter" && searchResults[0]) {
                event.preventDefault();
                chooseSearchResult(searchResults[0]);
              }
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
            {normalizedQuery ? (
              <div
                id="study-settings-search-results"
                className="study-settings-results"
                aria-live="polite"
              >
                {searchResults.length > 0 && (
                  <h2>
                    {searchResults.length} träff
                    {searchResults.length === 1 ? "" : "ar"}
                  </h2>
                )}
                {searchResults.length ? (
                  <div className="study-settings-result-list">
                    {searchResults.slice(0, 12).map((entry) => {
                      const category = categories.find(
                        (item) => item.id === entry.category,
                      );
                      if (!category) return null;
                      const Icon = category.icon;
                      return (
                        <button
                          className="study-settings-result"
                          key={entry.target}
                          type="button"
                          onClick={() => chooseSearchResult(entry)}
                        >
                          <Icon aria-hidden="true" />
                          <span>
                            <strong>{entry.title}</strong>
                            <small>{category.title}</small>
                          </span>
                          <ChevronRight aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <NextEmptyState
                    className="study-settings-empty"
                    icon={<Search />}
                    title="Inga matchande inställningar"
                    description="Prova ett kortare ord, en synonym eller sök på exempelvis mikrofon, GPU, API-nyckel eller backup."
                    action={
                      <NextButton onClick={() => setQuery("")}>
                        Visa alla
                      </NextButton>
                    }
                  />
                )}
                {searchResults.length > 12 && (
                  <p className="study-settings-search-count">
                    Visar 12 av {searchResults.length}. Skriv ett ord till för
                    att begränsa sökningen.
                  </p>
                )}
              </div>
            ) : (
              activeCategory === "library" && (
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
                      Lagras lokalt
                    </span>
                  </NextSurface>
                  <NextSection
                    className="study-settings-group"
                    title="Flytta ditt bibliotek"
                  >
                    <NextSettingRow
                      id="library-import"
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
                        name="library-import"
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
                      id="library-export"
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

                  <NextSection
                    className="study-settings-group"
                    title="Ett steg tillbaka, om det behövs"
                  >
                    <NextSettingRow
                      id="backup-create"
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
                      id="backup-limit"
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
                </>
              )
            )}
            {!normalizedQuery && activeCategory !== "library" && (
              <SettingsPanel
                category={activeCategory}
                client={client}
                settings={settings}
                update={updateSettings}
                onNotice={(text, error = false) => setNotice({ text, error })}
              />
            )}
            {progress && (
              <div
                className="study-transfer-status"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
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
                aria-live={notice.error ? "assertive" : "polite"}
                aria-atomic="true"
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
            <footer>
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
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
