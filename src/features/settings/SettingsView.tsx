import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  AudioLines,
  FileDown,
  FileUp,
  KeyRound,
  Languages,
  Palette,
  MonitorCog,
  PlugZap,
  ShieldCheck,
  Cpu,
  DownloadCloud,
  Trash2,
  Sparkles,
  Zap,
  HardDrive,
  LoaderCircle,
  Unplug,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useAppStore } from "../../core/store";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Input, Label, Select, Textarea } from "../../components/ui/Form";
import { getDecks, testAnki } from "../../services/anki";
import { toast } from "../../services/feedbackToast";
import { strFromU8, strToU8, unzip, zip } from "fflate";
import { db } from "../../core/database";
import {
  confirmStorageForImport,
  downloadBlob,
  downloadText,
} from "../../lib/utils";
import { formatGlossary, glossaryTerms } from "../../services/glossary";
import type {
  LibraryBackup,
  StoredAsset,
  ThemePalette,
} from "../../core/types";
import {
  connectGoogleDrive,
  cancelGoogleDriveConnection,
  disconnectGoogleDrive,
  syncErrorMessage,
  syncProviderOptions,
} from "../../services/sync";
import { syncGoogleDrive } from "../../services/googleDriveSync";
import {
  backupSourceFromState,
  createLibraryBackup,
  normalizeLibraryBackup,
  restoreBackupAssets,
} from "../../services/libraryBackup";
import { isTauri } from "../../services/platform";
import {
  builtInPalettes,
  defaultCustomPalette,
  normalizePalette,
  resolvePalette,
} from "../../core/theme";
import {
  benchmarkLocalEngine,
  downloadLocalModel,
  getLocalModelStatus,
  getLocalEngineStatus,
  installNvidiaRuntime,
  removeLocalModel,
  removeNvidiaRuntime,
  type LocalEngineStatus,
  type LocalModel,
  type LocalModelStatus,
} from "../../services/localStt";
import { aiModelSuggestions } from "../../services/ai";

const aiBaseUrls = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  groq: "https://api.groq.com/openai/v1",
  custom: "",
} as const;

const transcriptionDefaults = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "whisper-1",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "whisper-large-v3-turbo",
  },
} as const;

const MAX_LIBRARY_IMPORT_BYTES = 1536 * 1024 * 1024;
const MAX_LIBRARY_ASSETS = 5_000;

function validateLibraryPayload(data: Record<string, unknown>) {
  if (data.version !== 1)
    throw new Error("Exporten har en version som Lectio inte kan läsa");
  for (const field of ["nodes", "segments", "markers", "cards"]) {
    if (!Array.isArray(data[field]))
      throw new Error(`Exporten saknar giltigt fält: ${field}`);
  }
  if (!data.lectures || typeof data.lectures !== "object")
    throw new Error("Exporten saknar föreläsningsdata");
  const nodes = data.nodes as Array<unknown>;
  if (nodes.length > 5_000)
    throw new Error("Exporten innehåller för många biblioteksobjekt");
  const parentById = new Map<string, string | null>();
  for (const entry of nodes) {
    if (!entry || typeof entry !== "object")
      throw new Error("Exporten innehåller ett ogiltigt biblioteksobjekt");
    const node = entry as { id?: unknown; parentId?: unknown };
    if (
      typeof node.id !== "string" ||
      !node.id ||
      (node.parentId !== null && typeof node.parentId !== "string") ||
      parentById.has(node.id)
    )
      throw new Error("Exporten innehåller ogiltiga eller dubbla objekt-ID:n");
    parentById.set(node.id, node.parentId ?? null);
  }
  for (const [id, parentId] of parentById) {
    if (parentId && !parentById.has(parentId))
      throw new Error(`Biblioteksobjektet ${id} har en saknad överordnad nivå`);
  }
  for (const id of parentById.keys()) {
    const visited = new Set<string>();
    let current: string | null = id;
    while (current) {
      if (visited.has(current))
        throw new Error("Exporten innehåller en cirkulär biblioteksstruktur");
      visited.add(current);
      current = parentById.get(current) ?? null;
    }
  }
}

function validateAssetManifest(
  manifest: Array<Omit<StoredAsset, "blob"> & { path: string }>,
  archive: Record<string, Uint8Array>,
) {
  if (manifest.length > MAX_LIBRARY_ASSETS)
    throw new Error(
      `Exporten innehåller fler än ${MAX_LIBRARY_ASSETS} mediafiler`,
    );
  for (const item of manifest) {
    if (
      !item.id ||
      !item.lectureId ||
      !item.path.startsWith("media/") ||
      item.path.includes("..") ||
      !archive[item.path]
    ) {
      throw new Error("Exporten innehåller en ogiltig mediasökväg");
    }
  }
}

const zipAsync = (files: Record<string, Uint8Array>) =>
  new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 6 }, (error, data) =>
      error ? reject(error) : resolve(data),
    );
  });

const unzipAsync = (data: Uint8Array) =>
  new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(data, (error, files) => (error ? reject(error) : resolve(files)));
  });

export function SettingsView() {
  const glossaryFileRef = useRef<HTMLInputElement>(null);
  const store = useAppStore();
  const {
    settings,
    nodes,
    updateSettings,
    importLibrary,
    restoreLibraryBackup,
    upsertJob,
  } = store;
  const [tab, setTab] = useState("profile");
  const [ankiOk, setAnkiOk] = useState(false);
  const [ankiDecks, setAnkiDecks] = useState<string[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteDraft, setPaletteDraft] =
    useState<ThemePalette>(defaultCustomPalette);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [cloudConnectBusy, setCloudConnectBusy] = useState(false);
  const storageSummary = useLiveQuery(async () => {
    const [assets, sessions, chunks] = await Promise.all([
      db.assets.toArray(),
      db.recordingSessions.toArray(),
      db.recordingChunks.toArray(),
    ]);
    const sessionById = new Map(
      sessions.map((session) => [session.id, session]),
    );
    const titleForLecture = (lectureId: string) =>
      nodes.find((node) => node.id === lectureId)?.title ?? "Okänd föreläsning";
    const files = [
      ...assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        lecture: titleForLecture(asset.lectureId),
        size: asset.blob.size,
      })),
      ...chunks.map((chunk) => {
        const session = sessionById.get(chunk.sessionId);
        return {
          id: chunk.id,
          name: "Tillfällig inspelningsdel",
          lecture: session
            ? titleForLecture(session.lectureId)
            : "Okänd föreläsning",
          size: chunk.blob.size,
        };
      }),
    ].sort((a, b) => b.size - a.size);
    return {
      total: files.reduce((sum, file) => sum + file.size, 0),
      files,
      interruptedSessions: sessions.filter(
        (session) => session.status === "interrupted",
      ),
    };
  }, [nodes]);
  const backups = useLiveQuery(
    () => db.backups.orderBy("createdAt").reverse().toArray(),
    [],
  );
  const createBackup = async (reason: LibraryBackup["reason"]) => {
    const snapshot = useAppStore.getState();
    return createLibraryBackup(reason, backupSourceFromState(snapshot));
  };
  const setBackupLimit = async (backupLimit: number) => {
    updateSettings({ backupLimit });
    const all = await db.backups.orderBy("createdAt").toArray();
    if (all.length > backupLimit)
      await db.backups.bulkDelete(
        all.slice(0, -backupLimit).map((backup) => backup.id),
      );
  };
  const restoreBackup = async (rawBackup: LibraryBackup) => {
    const backup = normalizeLibraryBackup(rawBackup);
    const current = useAppStore.getState();
    const preview = [
      `Återställ metadata från ${new Date(backup.createdAt).toLocaleString("sv-SE")}?`,
      "",
      `Nuvarande: ${current.nodes.length} objekt, ${current.segments.length} transkriptsegment, ${current.cards.length} kort.`,
      `Säkerhetskopia: ${backup.nodes.length} objekt, ${backup.segments.length} transkriptsegment, ${backup.cards.length} kort.`,
      "",
      backup.retainedAssets?.length
        ? `Den här raderingsbackupen återställer även ${backup.retainedAssets.length} mediafil${backup.retainedAssets.length === 1 ? "" : "er"}. Nuvarande metadata sparas först som en ny säkerhetskopia.`
        : "Metadata återställs och befintliga lokala mediareferenser behålls. Nuvarande metadata sparas först som en ny säkerhetskopia.",
    ].join("\\n");
    if (!confirm(preview)) return;
    await createBackup("manual");
    const assets = await restoreBackupAssets(backup);
    restoreLibraryBackup(backup);
    toast.success(
      assets.missing
        ? `Bibliotekets metadata återställdes. ${assets.missing} äldre mediareferenser saknas.`
        : assets.restored
          ? `Bibliotek och ${assets.restored} återställda mediafiler är klara.`
          : "Bibliotekets metadata återställdes",
    );
  };
  const clearInterruptedRecordings = async () => {
    const sessions = storageSummary?.interruptedSessions ?? [];
    if (!sessions.length) return;
    if (
      !confirm(
        `Ta bort ${sessions.length} avbrutna inspelning${sessions.length === 1 ? "" : "ar"} och deras tillfälliga ljuddelar? Detta går inte att ångra.`,
      )
    )
      return;
    await db.transaction(
      "rw",
      db.recordingSessions,
      db.recordingChunks,
      async () => {
        await db.recordingChunks
          .where("sessionId")
          .anyOf(sessions.map((session) => session.id))
          .delete();
        await db.recordingSessions.bulkDelete(
          sessions.map((session) => session.id),
        );
      },
    );
    toast.success("Avbrutna inspelningar rensades");
  };
  const connectCloudAccount = async () => {
    if (settings.cloudSync.provider !== "google-drive") {
      toast.error(
        "Google Drive är den enda tillgängliga direktanslutningen just nu.",
      );
      return;
    }
    setCloudConnectBusy(true);
    try {
      const connection = await connectGoogleDrive();
      updateSettings({
        cloudSync: {
          ...settings.cloudSync,
          accountLabel: connection.accountLabel,
          connectedAt: new Date().toISOString(),
        },
      });
      toast.success(`Google Drive anslöts: ${connection.accountLabel}`);
    } catch (error) {
      const message = syncErrorMessage(
        error,
        "Kunde inte ansluta Google Drive.",
      );
      if (message.includes("avbröts")) toast.message(message);
      else toast.error(message);
    } finally {
      setCloudConnectBusy(false);
    }
  };
  const cancelCloudConnection = async () => {
    await cancelGoogleDriveConnection();
    setCloudConnectBusy(false);
    toast.message("Google-inloggningen avbröts. Du kan försöka igen direkt.");
  };
  const syncCloudLibrary = async () => {
    if (!settings.cloudSync.connectedAt) {
      toast.error("Koppla Google Drive innan du synkar.");
      return;
    }
    setCloudConnectBusy(true);
    try {
      await syncGoogleDrive();
      toast.success("Google Drive-synken är klar.");
    } catch (error) {
      toast.error(
        syncErrorMessage(error, "Google Drive-synken kunde inte slutföras."),
      );
    } finally {
      setCloudConnectBusy(false);
    }
  };
  const disconnectCloudAccount = async () => {
    if (settings.cloudSync.provider !== "google-drive") return;
    if (
      !confirm(
        "Koppla bort Google Drive från Lectio? Den lokala informationen behålls.",
      )
    )
      return;
    setCloudConnectBusy(true);
    try {
      await disconnectGoogleDrive();
      updateSettings({
        cloudSync: {
          ...settings.cloudSync,
          accountLabel: undefined,
          connectedAt: undefined,
          lastSyncedAt: undefined,
        },
      });
      toast.success("Google Drive kopplades bort från Lectio.");
    } catch (error) {
      toast.error(
        syncErrorMessage(error, "Kunde inte koppla bort Google Drive."),
      );
    } finally {
      setCloudConnectBusy(false);
    }
  };
  const selectedPalette = resolvePalette(
    settings.selectedPaletteId,
    settings.customPalettes,
  );
  const editPalette = () => {
    const custom = settings.customPalettes.find(
      (palette) => palette.id === settings.selectedPaletteId,
    );
    setPaletteDraft(
      custom
        ? normalizePalette(custom)
        : {
            ...selectedPalette,
            id: crypto.randomUUID(),
            name: `${selectedPalette.name} – egen`,
          },
    );
    setPaletteOpen(true);
  };
  const savePalette = () => {
    const name = paletteDraft.name.trim();
    if (!name) return toast.error("Ge paletten ett namn");
    const palette = { ...paletteDraft, name };
    updateSettings({
      customPalettes: [
        ...settings.customPalettes.filter((item) => item.id !== palette.id),
        palette,
      ],
      selectedPaletteId: palette.id,
    });
    setPaletteOpen(false);
    toast.success("Paletten sparades lokalt");
  };
  const deleteSelectedPalette = () => {
    if (
      !settings.customPalettes.some(
        (palette) => palette.id === settings.selectedPaletteId,
      )
    )
      return;
    updateSettings({
      customPalettes: settings.customPalettes.filter(
        (palette) => palette.id !== settings.selectedPaletteId,
      ),
      selectedPaletteId: "chalk-neutral",
    });
  };
  const exportAll = async () => {
    if (libraryBusy) return;
    setLibraryBusy(true);
    const jobId = "library:export";
    const { nodes, lectures, segments, markers, cards, settings } =
      useAppStore.getState();
    try {
      const assets = await db.assets.toArray();
      const total = assets.length + 2;
      upsertJob({
        id: jobId,
        kind: "library",
        label: "Exporterar bibliotek",
        phase: "exporting",
        status: "active",
        current: 0,
        total,
        detail: "Förbereder biblioteket…",
      });
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        nodes,
        lectures,
        segments,
        markers,
        cards,
        settings,
      };
      const files: Record<string, Uint8Array> = {
        "library.json": strToU8(JSON.stringify(payload, null, 2)),
        "README.txt": strToU8(
          "Lectio-export. Strukturerad metadata finns i library.json och originalfiler i media/.",
        ),
      };
      const assetManifest: Array<Omit<StoredAsset, "blob"> & { path: string }> =
        [];
      for (const [index, asset] of assets.entries()) {
        const safeName = asset.name.replace(/[<>:"/\\|?*]/g, "_");
        const path = `media/${asset.lectureId}/${asset.id}-${asset.kind}-${safeName}`;
        files[path] = new Uint8Array(await asset.blob.arrayBuffer());
        const { blob: _blob, ...metadata } = asset;
        void _blob;
        assetManifest.push({ ...metadata, path });
        upsertJob({
          id: jobId,
          kind: "library",
          label: "Exporterar bibliotek",
          phase: "exporting",
          status: "active",
          current: index + 1,
          total,
          detail: `Förbereder ${index + 1} av ${assets.length} filer…`,
        });
      }
      files["assets.json"] = strToU8(JSON.stringify(assetManifest, null, 2));
      upsertJob({
        id: jobId,
        kind: "library",
        label: "Exporterar bibliotek",
        phase: "packing",
        status: "active",
        current: total - 1,
        total,
        detail: "Komprimerar exporten…",
      });
      const archive = await zipAsync(files);
      const verification = await unzipAsync(archive);
      if (!verification["library.json"] || !verification["assets.json"])
        throw new Error("Exporten kunde inte verifieras");
      downloadBlob(
        `lectio-export-${new Date().toISOString().slice(0, 10)}.zip`,
        new Blob([archive.buffer as ArrayBuffer], { type: "application/zip" }),
      );
      upsertJob({
        id: jobId,
        kind: "library",
        label: "Exporterar bibliotek",
        phase: "complete",
        status: "complete",
        current: total,
        total,
        detail: "Exporten är klar.",
      });
      toast.success("Hela biblioteket exporterades");
    } catch (error) {
      upsertJob({
        id: jobId,
        kind: "library",
        label: "Exporterar bibliotek",
        phase: "error",
        status: "error",
        current: 0,
        detail: "Exporten kunde inte slutföras.",
      });
      toast.error(
        error instanceof Error ? error.message : "Exporten misslyckades",
      );
    } finally {
      setLibraryBusy(false);
    }
  };
  const importAll = async (file?: File) => {
    if (!file || libraryBusy) return;
    if (file.size > MAX_LIBRARY_IMPORT_BYTES) {
      toast.error(
        "Importfilen är större än 1,5 GB. Dela upp biblioteket eller importera i mindre delar.",
      );
      return;
    }
    if (!(await confirmStorageForImport(file, "biblioteksimporten"))) return;
    setLibraryBusy(true);
    const jobId = "library:import";
    try {
      await createBackup("import");
      upsertJob({
        id: jobId,
        kind: "library",
        label: "Importerar bibliotek",
        phase: "importing",
        status: "active",
        current: 0,
        detail: "Läser importfilen…",
      });
      let data: Record<string, unknown>;
      if (file.name.toLowerCase().endsWith(".zip")) {
        upsertJob({
          id: jobId,
          kind: "library",
          label: "Importerar bibliotek",
          phase: "importing",
          status: "active",
          current: 0,
          detail: "Packar upp arkivet…",
        });
        const archive = await unzipAsync(
          new Uint8Array(await file.arrayBuffer()),
        );
        if (!archive["library.json"]) throw new Error("library.json saknas");
        data = JSON.parse(strFromU8(archive["library.json"]));
        validateLibraryPayload(data);
        if (archive["assets.json"]) {
          const manifest = JSON.parse(
            strFromU8(archive["assets.json"]),
          ) as Array<Omit<StoredAsset, "blob"> & { path: string }>;
          validateAssetManifest(manifest, archive);
          const total = manifest.length + 1;
          await db.transaction("rw", db.assets, async () => {
            for (const [index, item] of manifest.entries()) {
              const bytes = archive[item.path];
              if (bytes)
                await db.assets.put({
                  ...item,
                  blob: new Blob([bytes.buffer as ArrayBuffer], {
                    type: item.mimeType,
                  }),
                });
              upsertJob({
                id: jobId,
                kind: "library",
                label: "Importerar bibliotek",
                phase: "importing",
                status: "active",
                current: index + 1,
                total,
                detail: `Återställer ${index + 1} av ${manifest.length} filer…`,
              });
            }
          });
        }
      } else {
        data = JSON.parse(await file.text());
        validateLibraryPayload(data);
      }
      importLibrary(data);
      upsertJob({
        id: jobId,
        kind: "library",
        label: "Importerar bibliotek",
        phase: "complete",
        status: "complete",
        current: 1,
        total: 1,
        detail: "Biblioteket är klart.",
      });
      toast.success("Biblioteket importerades");
    } catch (error) {
      upsertJob({
        id: jobId,
        kind: "library",
        label: "Importerar bibliotek",
        phase: "error",
        status: "error",
        current: 0,
        detail: "Importen kunde inte slutföras.",
      });
      toast.error(
        error instanceof Error ? error.message : "Filen kunde inte importeras",
      );
    } finally {
      setLibraryBusy(false);
    }
  };
  const tabs = [
    { id: "general", label: "Generellt", icon: Languages },
    { id: "transcription", label: "Transkribering", icon: AudioLines },
    { id: "anki", label: "Anki", icon: PlugZap },
    { id: "sync", label: "Synk", icon: DownloadCloud },
  ];
  return (
    <div className="ui-app-bg flex min-w-0 flex-1 flex-col">
      <header className="flex min-h-16 items-center border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">
            Inställningar
          </h1>
          <p className="text-xs text-slate-400">
            Lokala val, providers och integrationer
          </p>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] xl:grid-cols-[240px_minmax(0,1fr)] xl:grid-rows-1">
        <aside className="overflow-x-auto border-b border-slate-200 bg-white p-2 xl:overflow-visible xl:border-b-0 xl:border-r xl:p-3">
          <nav className="flex min-w-max gap-1 xl:block xl:min-w-0">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex h-10 items-center gap-2 rounded-lg px-3 text-sm xl:mb-1 xl:w-full xl:gap-3 ${tab === id ? "bg-violet-50 font-semibold text-violet-800" : "text-slate-600 hover:bg-slate-50"}`}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </nav>
        </aside>
        <main className="overflow-auto p-4 sm:p-6 xl:p-8">
          <div className="mx-auto max-w-5xl">
            {tab === "general" && (
              <Section
                title="Generellt"
                description="Språk, bibliotek och lokal datahantering."
              >
                <Field label="Språk i appen">
                  <Select
                    value={settings.locale}
                    onChange={(e) =>
                      updateSettings({ locale: e.target.value as "sv" | "en" })
                    }
                  >
                    <option value="sv">Svenska</option>
                    <option value="en">English (förhandsvisning)</option>
                  </Select>
                </Field>
                <div className="border-t border-slate-100 pt-6">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <Palette className="size-4 text-violet-500" /> Färgpalett
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Paletten styr hela appens bakgrund, ytor, text och knappar.
                  </p>
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                    <Field label="Aktiv palett">
                      <Select
                        value={settings.selectedPaletteId}
                        onChange={(event) =>
                          updateSettings({
                            selectedPaletteId: event.target.value,
                          })
                        }
                      >
                        <optgroup label="Medföljande">
                          {builtInPalettes.map((palette) => (
                            <option key={palette.id} value={palette.id}>
                              {palette.name}
                            </option>
                          ))}
                        </optgroup>
                        {!!settings.customPalettes.length && (
                          <optgroup label="Mina paletter">
                            {settings.customPalettes.map((palette) => (
                              <option key={palette.id} value={palette.id}>
                                {palette.name}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </Select>
                    </Field>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={editPalette}>
                        {settings.customPalettes.some(
                          (palette) =>
                            palette.id === settings.selectedPaletteId,
                        )
                          ? "Redigera"
                          : "Skapa egen"}
                      </Button>
                      {settings.customPalettes.some(
                        (palette) => palette.id === settings.selectedPaletteId,
                      ) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={deleteSelectedPalette}
                          title="Ta bort egen palett"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div
                    className="mt-3 flex gap-1.5"
                    aria-label="Palettens färger"
                  >
                    {[
                      selectedPalette.background,
                      selectedPalette.surface,
                      selectedPalette.surfaceMuted,
                      selectedPalette.text,
                      selectedPalette.primary,
                    ].map((color, index) => (
                      <span
                        key={`${color}-${index}`}
                        className="size-7 rounded-md border border-slate-200"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
                <div className="border-t border-slate-100 pt-6">
                  <h3 className="text-sm font-semibold text-slate-800">
                    Bibliotek
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Importera, exportera och behåll kontrollen över din data.
                  </p>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                      onClick={() => void exportAll()}
                      disabled={libraryBusy}
                      className="rounded-xl border border-slate-200 bg-white p-6 text-left hover:border-violet-300 disabled:cursor-wait disabled:opacity-60"
                    >
                      <FileDown className="size-5 text-violet-600" />
                      <div className="mt-3 text-sm font-semibold">
                        Exportera bibliotek
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate-400">
                        ZIP med JSON, ljud, slides och andra originalfiler.
                      </div>
                    </button>
                    <label
                      className={`cursor-pointer rounded-xl border border-slate-200 bg-white p-6 text-left hover:border-violet-300 ${libraryBusy ? "pointer-events-none opacity-60" : ""}`}
                    >
                      <FileUp className="size-5 text-violet-600" />
                      <div className="mt-3 text-sm font-semibold">
                        Importera bibliotek
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate-400">
                        Återställ från en Lectio JSON-export.
                      </div>
                      <input
                        type="file"
                        accept="application/json,.zip,application/zip"
                        className="hidden"
                        onChange={(e) => importAll(e.target.files?.[0])}
                      />
                    </label>
                  </div>
                  <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-xs leading-5 text-emerald-800">
                    Metadata lagras lokalt. Exporten använder öppna filer: JSON
                    för strukturerad data och originalformat för ljud, PDF och
                    bilder.
                  </div>
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex items-start gap-3">
                      <HardDrive className="mt-0.5 size-5 shrink-0 text-violet-600" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-800">
                          Lokal lagring
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          {storageSummary
                            ? `${formatBytes(storageSummary.total)} används av ${storageSummary.files.length} lokala filer och inspelningsdelar.`
                            : "Beräknar lagringsanvändning…"}
                        </p>
                      </div>
                    </div>
                    {!!storageSummary?.files.length && (
                      <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Största filer
                        </div>
                        {storageSummary.files.slice(0, 5).map((file) => (
                          <div
                            key={file.id}
                            className="flex min-w-0 items-center justify-between gap-3 text-xs"
                          >
                            <span className="min-w-0 truncate text-slate-600">
                              {file.lecture} · {file.name}
                            </span>
                            <span className="shrink-0 tabular-nums text-slate-400">
                              {formatBytes(file.size)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {!!storageSummary?.interruptedSessions.length && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="mt-4"
                        onClick={() => void clearInterruptedRecordings()}
                      >
                        <Trash2 className="size-3.5" /> Rensa avbrutna
                        inspelningar
                      </Button>
                    )}
                    <LocalAiStorageSummary />
                  </div>
                </div>
              </Section>
            )}
            {tab === "sync" && (
              <Section
                title="Direkt molnsynk"
                description="Koppla ditt eget konto direkt. Lectio kräver ingen separat molnapp och lagrar inga lösenord."
              >
                <div className="space-y-6">
                  <div>
                    <p className="text-sm font-medium text-[var(--palette-text)]">
                      Google Drive
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[var(--palette-text-muted)]">
                      {syncProviderOptions[0]?.description}
                    </p>
                  </div>

                  <div className="rounded-xl border border-[var(--palette-border)] bg-[var(--palette-surface-muted)] p-4">
                    <p className="text-sm font-medium text-[var(--palette-text)]">
                      Kontokoppling
                    </p>
                    <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--palette-text-muted)]">
                      Du loggar in i tjänstens säkra webbfönster och kan när som
                      helst koppla bort kontot. Åtkomsttoken sparas endast i
                      Windows Credential Manager.
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {settings.cloudSync.provider === "google-drive" &&
                      settings.cloudSync.connectedAt ? (
                        <>
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--palette-success-muted)] px-2 py-1 text-xs font-medium text-[var(--palette-success)]">
                            <CheckCircle2 className="size-3.5" />
                            Ansluten
                            {settings.cloudSync.accountLabel
                              ? ` · ${settings.cloudSync.accountLabel}`
                              : ""}
                          </span>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={cloudConnectBusy}
                            onClick={() => void disconnectCloudAccount()}
                          >
                            {cloudConnectBusy ? (
                              <LoaderCircle className="size-3.5 animate-spin" />
                            ) : (
                              <Unplug className="size-3.5" />
                            )}
                            Koppla bort
                          </Button>
                          <Button
                            size="sm"
                            disabled={cloudConnectBusy}
                            onClick={() => void syncCloudLibrary()}
                          >
                            {cloudConnectBusy ? (
                              <LoaderCircle className="size-3.5 animate-spin" />
                            ) : (
                              <HardDrive className="size-3.5" />
                            )}
                            Synka nu
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={cloudConnectBusy || !isTauri()}
                            onClick={() => void connectCloudAccount()}
                          >
                            {cloudConnectBusy && (
                              <LoaderCircle className="size-3.5 animate-spin" />
                            )}
                            Koppla Google Drive
                          </Button>
                          {cloudConnectBusy && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void cancelCloudConnection()}
                            >
                              Avbryt inloggning
                            </Button>
                          )}
                          <span className="text-xs text-[var(--palette-text-subtle)]">
                            {!isTauri()
                              ? "Öppna desktopappen för att koppla ett konto"
                              : "Öppnar en säker Google-inloggning i din webbläsare"}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 rounded-xl border border-[var(--palette-border)] bg-[var(--palette-surface-muted)] p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-semibold text-[var(--palette-text)]">
                          Lokala säkerhetskopior
                        </div>
                        <p className="mt-1 text-xs leading-5 text-[var(--palette-text-muted)]">
                          Metadata sparas före import och radering. Ljud och
                          PDF-filer dupliceras inte.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void createBackup("manual").then(() =>
                            toast.success("Säkerhetskopia skapades"),
                          )
                        }
                      >
                        Skapa nu
                      </Button>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--palette-border)] pt-3 text-xs">
                      <span className="text-[var(--palette-text-muted)]">
                        Behåll de senaste säkerhetskopiorna
                      </span>
                      <Select
                        className="h-8 w-20 py-1 text-xs"
                        value={settings.backupLimit ?? 10}
                        onChange={(event) =>
                          void setBackupLimit(Number(event.target.value))
                        }
                      >
                        {[3, 5, 10, 20, 50].map((limit) => (
                          <option key={limit} value={limit}>
                            {limit}
                          </option>
                        ))}
                      </Select>
                    </div>
                    {backups?.length ? (
                      <div className="mt-3 space-y-2 border-t border-[var(--palette-border)] pt-3">
                        {backups
                          .slice(0, settings.backupLimit ?? 10)
                          .map((backup) => (
                            <div
                              key={backup.id}
                              className="flex items-center justify-between gap-3 text-xs"
                            >
                              <span className="min-w-0 text-[var(--palette-text-muted)]">
                                {new Date(backup.createdAt).toLocaleString(
                                  "sv-SE",
                                )}{" "}
                                ·{" "}
                                {backup.reason === "import"
                                  ? "före import"
                                  : backup.reason === "deletion"
                                    ? "före radering"
                                    : "manuell"}{" "}
                                · ≈
                                {Math.max(
                                  1,
                                  Math.ceil(
                                    JSON.stringify(backup).length / 1024,
                                  ),
                                )}{" "}
                                kB metadata
                              </span>
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => void restoreBackup(backup)}
                              >
                                Förhandsgranska och återställ
                              </Button>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-[var(--palette-text-subtle)]">
                        Inga säkerhetskopior ännu.
                      </p>
                    )}
                  </div>

                  <Field label="Mapp i Google Drive">
                    <Input
                      value={settings.cloudSync.remotePath}
                      onChange={(event) =>
                        updateSettings({
                          cloudSync: {
                            ...settings.cloudSync,
                            remotePath: event.target.value,
                          },
                        })
                      }
                      placeholder="Lectio"
                    />
                  </Field>
                  <p className="-mt-4 text-xs leading-5 text-[var(--palette-text-muted)]">
                    Standard är{" "}
                    <span className="font-medium text-[var(--palette-text)]">
                      Lectio
                    </span>{" "}
                    i Google Drive-roten. Du kan ange en egen sökväg, exempelvis{" "}
                    <span className="font-medium text-[var(--palette-text)]">
                      Studier/Lectio
                    </span>
                    . Lämna tomt för standardmappen.
                  </p>

                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--palette-border)] bg-[var(--palette-surface)] p-4 transition-colors hover:bg-[var(--palette-surface-hover)]">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-[var(--palette-primary)]"
                      checked={settings.cloudSync.autoSyncOnStartAndClose}
                      onChange={(event) =>
                        updateSettings({
                          cloudSync: {
                            ...settings.cloudSync,
                            autoSyncOnStartAndClose: event.target.checked,
                          },
                        })
                      }
                    />
                    <span>
                      <span className="block text-sm font-medium text-[var(--palette-text)]">
                        Synka automatiskt vid stängning
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-[var(--palette-text-muted)]">
                        När du stänger appen väntar Lectio tills pågående
                        ändringar har synkats, så att biblioteket inte lämnas
                        osynkat. Vid start väljer du själv när synken körs.
                      </span>
                    </span>
                  </label>

                  <div className="border-t border-[var(--palette-border)] pt-5">
                    <p className="text-sm font-medium text-[var(--palette-text)]">
                      Så fungerar synken
                    </p>
                    <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--palette-text-muted)]">
                      Lectio skapar mapparna{" "}
                      <span className="font-medium text-[var(--palette-text)]">
                        metadata
                      </span>{" "}
                      och{" "}
                      <span className="font-medium text-[var(--palette-text)]">
                        media
                      </span>{" "}
                      under din valda Lectio-mapp. Oförändrade ljud och PDF:er
                      laddas inte upp igen. Orelaterade ändringar på olika
                      datorer förenas automatiskt; bara samma fält kräver ett
                      val.
                    </p>
                  </div>
                </div>
              </Section>
            )}
            {tab === "anki" && (
              <Section
                title="Anki och kortgenerering"
                description="Konfigurera kort, AI-underlag och AnkiConnect på ett ställe."
              >
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">
                    Kortgenerering
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Välj hur föreläsningsmaterial skickas till en språkmodell.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ChoiceCard
                    selected={settings.aiMode === "clipboard"}
                    icon={KeyRound}
                    title="Copy/paste"
                    description="Standard · använd en befintlig AI-prenumeration"
                    onClick={() => updateSettings({ aiMode: "clipboard" })}
                  />
                  <ChoiceCard
                    selected={settings.aiMode === "api"}
                    icon={Zap}
                    title="Eget API"
                    description="Direkt generering med en tillfällig API-nyckel"
                    onClick={() => updateSettings({ aiMode: "api" })}
                  />
                </div>
                {settings.aiMode === "clipboard" ? (
                  <InfoPanel
                    icon={ShieldCheck}
                    title="Ingen API-nyckel behövs"
                    text="Lectio skapar en komplett prompt. Du väljer själv ChatGPT, Claude eller Gemini och klistrar tillbaka svaret för granskning."
                  />
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-6">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="AI-provider">
                        <Select
                          value={settings.aiProvider}
                          onChange={(event) => {
                            const provider = event.target
                              .value as typeof settings.aiProvider;
                            const suggestedModel =
                              aiModelSuggestions[provider][0];
                            updateSettings({
                              aiProvider: provider,
                              aiBaseUrl: aiBaseUrls[provider],
                              aiModel: suggestedModel ?? settings.aiModel,
                            });
                          }}
                        >
                          <option value="openai">OpenAI</option>
                          <option value="anthropic">Anthropic</option>
                          <option value="gemini">Gemini</option>
                          <option value="groq">Groq</option>
                          <option value="custom">OpenAI-kompatibel</option>
                        </Select>
                      </Field>
                      <Field label="Modell">
                        <>
                          <Input
                            list="lectio-ai-model-suggestions"
                            value={settings.aiModel}
                            onChange={(event) =>
                              updateSettings({ aiModel: event.target.value })
                            }
                            placeholder={
                              settings.aiProvider === "custom"
                                ? "Exempel: min-lokala-modell"
                                : "Välj eller skriv modell-ID"
                            }
                            aria-describedby="ai-model-help"
                          />
                          <datalist id="lectio-ai-model-suggestions">
                            {aiModelSuggestions[settings.aiProvider].map(
                              (model) => (
                                <option key={model} value={model} />
                              ),
                            )}
                          </datalist>
                          <p
                            id="ai-model-help"
                            className="mt-2 text-xs leading-5 text-slate-500"
                          >
                            {aiModelSuggestions[settings.aiProvider].length
                              ? `Förslag för ${settings.aiProvider}: ${aiModelSuggestions[settings.aiProvider].join(", ")}. Du kan alltid skriva ett eget modell-ID.`
                              : "Skriv modell-ID:t från din tjänst. Egna modellnamn bevaras."}
                          </p>
                        </>
                      </Field>
                    </div>
                    {settings.aiProvider === "custom" && (
                      <Field label="Bas-URL för OpenAI-kompatibelt API">
                        <Input
                          type="url"
                          value={settings.aiBaseUrl}
                          onChange={(event) =>
                            updateSettings({ aiBaseUrl: event.target.value })
                          }
                          placeholder="https://api.exempel.se/v1"
                          aria-describedby="ai-base-url-help"
                        />
                        <p
                          id="ai-base-url-help"
                          className="mt-2 text-xs leading-5 text-slate-500"
                        >
                          Använd en endpoint som stöder OpenAI-formatet för chat
                          completions.
                        </p>
                      </Field>
                    )}
                    <p className="mt-3 text-xs leading-5 text-slate-500">
                      API-nyckeln anges först när du genererar och sparas inte
                      av Lectio. Endast de valda leverantörernas officiella
                      API:er används.
                    </p>
                  </div>
                )}
                <Field label="Global context för Anki">
                  <Textarea
                    className="min-h-32"
                    value={settings.userContext}
                    onChange={(e) =>
                      updateSettings({ userContext: e.target.value })
                    }
                    placeholder="Exempel: Svara på svenska och prioritera kliniska samband."
                  />
                </Field>
                <div className="border-t border-slate-100 pt-6">
                  <h3 className="text-sm font-semibold text-slate-800">
                    AnkiConnect
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Anki måste vara öppet och tillägget AnkiConnect installerat.
                  </p>
                </div>
                <Field label="AnkiConnect-adress">
                  <Input
                    value={settings.ankiUrl}
                    onChange={(e) => {
                      updateSettings({ ankiUrl: e.target.value });
                      setAnkiOk(false);
                    }}
                  />
                </Field>
                <Field label="Reservlek för äldre material utan kurs">
                  {ankiDecks.length ? (
                    <Select
                      value={settings.defaultDeck}
                      onChange={(e) =>
                        updateSettings({ defaultDeck: e.target.value })
                      }
                    >
                      {!ankiDecks.includes(settings.defaultDeck) && (
                        <option value={settings.defaultDeck}>
                          {settings.defaultDeck}
                        </option>
                      )}
                      {ankiDecks.map((deck) => (
                        <option key={deck} value={deck}>
                          {deck}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      value={settings.defaultDeck}
                      onChange={(e) =>
                        updateSettings({ defaultDeck: e.target.value })
                      }
                    />
                  )}
                </Field>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await testAnki(settings.ankiUrl);
                      const decks = await getDecks(settings.ankiUrl);
                      setAnkiDecks(decks);
                      if (
                        decks.length &&
                        !decks.includes(settings.defaultDeck)
                      ) {
                        updateSettings({ defaultDeck: decks[0] });
                      }
                      setAnkiOk(true);
                      toast.success(
                        `AnkiConnect är anslutet · ${decks.length} lekar hittades`,
                      );
                    } catch (e) {
                      setAnkiOk(false);
                      toast.error(String(e));
                    }
                  }}
                >
                  {ankiOk ? (
                    <CheckCircle2 className="size-4 text-emerald-600" />
                  ) : (
                    <PlugZap className="size-4" />
                  )}{" "}
                  Testa anslutningen
                </Button>
              </Section>
            )}
            {tab === "transcription" && (
              <Section
                title="Transkribering"
                description="Bearbeta ljud helt lokalt eller skicka det till en vald API-provider."
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <ChoiceCard
                    selected={settings.transcriptionProvider === "local"}
                    icon={MonitorCog}
                    title="Lokalt på datorn"
                    description="Gratis, offline och privat · CPU eller NVIDIA"
                    onClick={() =>
                      updateSettings({ transcriptionProvider: "local" })
                    }
                  />
                  <ChoiceCard
                    selected={
                      settings.transcriptionProvider === "openai" ||
                      settings.transcriptionProvider === "groq"
                    }
                    icon={Zap}
                    title="Via API"
                    description="Snabb molnbearbetning med egen API-nyckel"
                    onClick={() =>
                      updateSettings({ transcriptionProvider: "openai" })
                    }
                  />
                </div>
                {settings.transcriptionProvider === "local" ? (
                  <LocalModelManager />
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-6">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Provider">
                        <Select
                          value={settings.transcriptionProvider}
                          onChange={(event) => {
                            const provider = event.target.value as
                              "openai" | "groq";
                            const preset = transcriptionDefaults[provider];
                            updateSettings({
                              transcriptionProvider: provider,
                              transcriptionBaseUrl: preset.baseUrl,
                              transcriptionModel: preset.model,
                            });
                          }}
                        >
                          <option value="openai">OpenAI</option>
                          <option value="groq">Groq</option>
                        </Select>
                      </Field>
                      <Field label="Modell">
                        <Input
                          value={settings.transcriptionModel}
                          onChange={(e) =>
                            updateSettings({
                              transcriptionModel: e.target.value,
                            })
                          }
                        />
                      </Field>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-amber-700">
                      Ljudfilen skickas till vald provider. API-nyckeln används
                      bara för den aktuella transkriberingen och sparas inte.
                    </p>
                  </div>
                )}
                <Field label="Transkriberingsordlista / initial prompt">
                  <Textarea
                    className="min-h-24"
                    value={settings.transcriptionPrompt ?? ""}
                    onChange={(event) =>
                      updateSettings({
                        transcriptionPrompt: event.target.value,
                      })
                    }
                    placeholder="Exempel: Medicinska termer: ileus, kolecystit, peritonit. Förkortningar: ABCDE, CRP."
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={glossaryFileRef}
                    type="file"
                    accept="text/plain,.txt,text/csv,.csv"
                    className="hidden"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      const imported = glossaryTerms(await file.text());
                      updateSettings({
                        transcriptionPrompt: formatGlossary([
                          ...glossaryTerms(settings.transcriptionPrompt),
                          ...imported,
                        ]),
                      });
                      toast.success(
                        `${imported.length} termer importerades till den globala ordlistan`,
                      );
                      event.currentTarget.value = "";
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => glossaryFileRef.current?.click()}
                  >
                    <FileUp className="size-3.5" /> Importera TXT/CSV
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      downloadText(
                        "lectio-fraslexikon.txt",
                        glossaryTerms(settings.transcriptionPrompt).join("\n"),
                        "text/plain",
                      )
                    }
                  >
                    <FileDown className="size-3.5" /> Exportera
                  </Button>
                </div>
                <p className="text-xs leading-5 text-slate-500">
                  Håll detta kort och termfokuserat. När en föreläsning
                  transkriberas kombineras det med ärvda fraslexikon från kurs,
                  modul och föreläsning — inte med vanligt context. Lokala
                  Whisper använder prompten på datorn; OpenAI och Groq får den
                  som API-prompt.
                </p>
              </Section>
            )}
          </div>
        </main>
      </div>
      <Dialog
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        title="Egen färgpalett"
        description="Paletten sparas bara lokalt i Lectio."
      >
        <div className="space-y-4">
          <Field label="Namn">
            <Input
              value={paletteDraft.name}
              onChange={(event) =>
                setPaletteDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <PaletteColor
              label="Bakgrund"
              field="background"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Yta"
              field="surface"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Dämpad yta"
              field="surfaceMuted"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Hover-yta"
              field="surfaceHover"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Text"
              field="text"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Dämpad text"
              field="textMuted"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Svag text"
              field="textSubtle"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Kantlinje"
              field="border"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Stark kantlinje"
              field="borderStrong"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Primär"
              field="primary"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Primär hover"
              field="primaryHover"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Dämpad primär"
              field="primaryMuted"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Dämpad primär hover"
              field="primaryMutedHover"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Text på primär"
              field="primaryForeground"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Accent / länkar"
              field="accent"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Fokusmarkering"
              field="focusRing"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Hero-bakgrund"
              field="heroBackground"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Hero-text"
              field="heroForeground"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Framgång"
              field="success"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Framgång, dämpad"
              field="successMuted"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Text på framgång"
              field="successForeground"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Varning"
              field="warning"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Varning, dämpad"
              field="warningMuted"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Text på varning"
              field="warningForeground"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Fel"
              field="danger"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Fel, dämpad"
              field="dangerMuted"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Text på fel"
              field="dangerForeground"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Information"
              field="info"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Information, dämpad"
              field="infoMuted"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
            <PaletteColor
              label="Text på information"
              field="infoForeground"
              palette={paletteDraft}
              setPalette={setPaletteDraft}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPaletteOpen(false)}>
              Avbryt
            </Button>
            <Button onClick={savePalette}>Spara palett</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function PaletteColor({
  label,
  field,
  palette,
  setPalette,
}: {
  label: string;
  field: Exclude<keyof ThemePalette, "id" | "name">;
  palette: ThemePalette;
  setPalette: React.Dispatch<React.SetStateAction<ThemePalette>>;
}) {
  return (
    <label className="space-y-1.5 text-xs font-medium text-slate-600">
      <span>{label}</span>
      <div className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2">
        <input
          type="color"
          value={palette[field]}
          onChange={(event) =>
            setPalette((current) => ({
              ...current,
              [field]: event.target.value,
            }))
          }
          className="size-7 cursor-pointer border-0 bg-transparent p-0"
        />
        <span className="font-mono text-[10px] uppercase text-slate-500">
          {palette[field]}
        </span>
      </div>
    </label>
  );
}
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-400">{description}</p>
      <div className="mt-6 space-y-5">{children}</div>
    </section>
  );
}

function ChoiceCard({
  selected,
  icon: Icon,
  title,
  description,
  onClick,
  disabled = false,
}: {
  selected: boolean;
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group flex min-h-24 items-start gap-3 rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
        selected
          ? "border-violet-400 bg-violet-50 ring-2 ring-violet-100"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-xl ${
          selected
            ? "bg-violet-600 text-white"
            : "bg-slate-100 text-slate-500 group-hover:bg-white"
        }`}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-800">
          {title}
        </span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">
          {description}
        </span>
      </span>
    </button>
  );
}

function InfoPanel({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
      <Icon className="mt-0.5 size-5 shrink-0 text-emerald-600" />
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <p className="mt-1 text-xs leading-5 text-emerald-800">{text}</p>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

const localModels: {
  id: LocalModel;
  name: string;
  size: string;
  hint: string;
}[] = [
  { id: "tiny", name: "Tiny", size: "75 MB", hint: "Snabb kontroll" },
  { id: "base", name: "Base", size: "142 MB", hint: "Lätt och snabb" },
  { id: "small", name: "Small", size: "466 MB", hint: "Bra kvalitet" },
  { id: "medium", name: "Medium", size: "1,5 GB", hint: "Hög kvalitet" },
  {
    id: "large-v3-turbo",
    name: "Large v3 Turbo",
    size: "1,5 GB",
    hint: "Rekommenderad för NVIDIA",
  },
  {
    id: "large-v3",
    name: "Large v3",
    size: "2,9 GB",
    hint: "Maximal kvalitet",
  },
];

function formatBytes(bytes: number) {
  if (!bytes) return "0 MB";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function LocalModelManager() {
  const { settings, updateSettings } = useAppStore();
  const selected = settings.localTranscriptionModel ?? "base";
  const [statuses, setStatuses] = useState<
    Partial<Record<LocalModel, LocalModelStatus>>
  >({});
  const [engine, setEngine] = useState<LocalEngineStatus | null>(null);
  const [working, setWorking] = useState<LocalModel | null>(null);
  const [workingEngine, setWorkingEngine] = useState(false);
  const [benchmarking, setBenchmarking] = useState(false);
  const refresh = async () => {
    const [values, engineStatus] = await Promise.all([
      Promise.all(localModels.map((model) => getLocalModelStatus(model.id))),
      getLocalEngineStatus(),
    ]);
    setStatuses(
      Object.fromEntries(values.map((status) => [status.model, status])),
    );
    setEngine(engineStatus);
  };
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- reads native filesystem state after mount
    void refresh();
  }, []);
  const download = async (model: LocalModel) => {
    setWorking(model);
    try {
      await downloadLocalModel(model);
      updateSettings({
        localTranscriptionModel: model,
        transcriptionProvider: "local",
      });
      await refresh();
      toast.success(`Whisper ${model} installerades`);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWorking(null);
    }
  };
  const remove = async (model: LocalModel) => {
    const name =
      localModels.find((candidate) => candidate.id === model)?.name ?? model;
    if (
      !confirm(
        `Ta bort Whisper ${name} från datorn? Modellen kan laddas ner igen senare.`,
      )
    )
      return;
    setWorking(model);
    try {
      await removeLocalModel(model);
      const fallback = localModels.find(
        (candidate) =>
          candidate.id !== model && statuses[candidate.id]?.installed,
      );
      if (selected === model && fallback) {
        updateSettings({ localTranscriptionModel: fallback.id });
      }
      await refresh();
      toast.success("Modellen togs bort");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWorking(null);
    }
  };
  const installGpu = async () => {
    setWorkingEngine(true);
    try {
      const status = await installNvidiaRuntime();
      setEngine(status);
      updateSettings({
        localTranscriptionAcceleration: status.nvidiaRuntimeReady
          ? "nvidia"
          : "auto",
      });
      if (status.nvidiaRuntimeReady) {
        toast.success("NVIDIA-acceleration installerades");
      } else {
        toast.error(
          "NVIDIA-stödet kunde inte startas. Lectio använder CPU tills det är åtgärdat.",
        );
      }
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWorkingEngine(false);
    }
  };
  const removeGpu = async () => {
    if (
      !confirm(
        "Ta bort NVIDIA-stödet för lokal transkribering? Det kan installeras igen senare.",
      )
    )
      return;
    setWorkingEngine(true);
    try {
      await removeNvidiaRuntime();
      updateSettings({ localTranscriptionAcceleration: "auto" });
      await refresh();
      toast.success("NVIDIA-runtime togs bort");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWorkingEngine(false);
    }
  };
  const acceleration = settings.localTranscriptionAcceleration ?? "auto";
  const benchmarkAcceleration =
    acceleration === "nvidia" ||
    (acceleration === "auto" && engine?.nvidiaRuntimeReady)
      ? "nvidia"
      : "cpu";
  const runBenchmark = async () => {
    if (!statuses[selected]?.installed) {
      toast.error("Ladda ner den valda Whisper-modellen först");
      return;
    }
    setBenchmarking(true);
    try {
      const result = await benchmarkLocalEngine(
        selected,
        benchmarkAcceleration,
      );
      updateSettings({
        localTranscriptionBenchmarks: {
          ...settings.localTranscriptionBenchmarks,
          [result.acceleration]: result,
        },
      });
      toast.success("Prestandatestet är klart");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBenchmarking(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
              <MonitorCog className="size-5" />
            </span>
            <div>
              <div className="text-sm font-semibold text-slate-800">
                Beräkningsmotor
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {engine?.nvidiaDetected
                  ? `${engine.nvidiaName}${engine.nvidiaVramTotalMb ? ` · ${formatBytes(engine.nvidiaVramTotalMb * 1024 * 1024)} VRAM` : ""}`
                  : "Inget NVIDIA-kort hittades · CPU fungerar alltid"}
              </div>
            </div>
          </div>
          {engine?.nvidiaRuntimeInstalled && engine.nvidiaRuntimeReady ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void removeGpu()}
              disabled={workingEngine}
            >
              <Trash2 className="size-3.5" /> Ta bort NVIDIA-stöd
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => void installGpu()}
              disabled={workingEngine || !engine?.nvidiaDetected}
            >
              {workingEngine ? (
                <DownloadCloud className="size-3.5 animate-pulse" />
              ) : (
                <Zap className="size-3.5" />
              )}
              {workingEngine
                ? "Installerar ~670 MB…"
                : engine?.nvidiaRuntimeInstalled
                  ? "Installera om NVIDIA-stöd"
                  : "Installera NVIDIA-stöd"}
            </Button>
          )}
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <ChoiceCard
            selected={acceleration === "auto"}
            icon={Sparkles}
            title="Automatiskt"
            description="NVIDIA när det finns, annars CPU"
            onClick={() =>
              updateSettings({ localTranscriptionAcceleration: "auto" })
            }
          />
          <ChoiceCard
            selected={acceleration === "nvidia"}
            icon={Zap}
            title="NVIDIA"
            description={
              engine?.nvidiaRuntimeReady
                ? `Installerat · ${formatBytes(engine.nvidiaRuntimeSize)}`
                : engine?.nvidiaRuntimeInstalled
                  ? "Kunde inte initieras · installera om stödet"
                  : "Installera CUDA-motorn först"
            }
            disabled={!engine?.nvidiaRuntimeReady}
            onClick={() =>
              updateSettings({ localTranscriptionAcceleration: "nvidia" })
            }
          />
          <ChoiceCard
            selected={acceleration === "cpu"}
            icon={Cpu}
            title="CPU"
            description="Kompatibelt men långsammare"
            onClick={() =>
              updateSettings({ localTranscriptionAcceleration: "cpu" })
            }
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          <span>
            Testa{" "}
            {localModels.find((model) => model.id === selected)?.name ??
              selected}{" "}
            på {benchmarkAcceleration === "nvidia" ? "NVIDIA" : "CPU"}. Testet
            använder 20 sekunders syntetiskt ljud och sparas bara lokalt.
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void runBenchmark()}
            disabled={benchmarking || !statuses[selected]?.installed}
          >
            {benchmarking ? "Testar…" : "Kör prestandatest"}
          </Button>
          {settings.localTranscriptionBenchmarks[benchmarkAcceleration] && (
            <span className="w-full text-slate-500">
              Senaste test:{" "}
              {Math.max(
                1,
                Math.round(
                  1 /
                    settings.localTranscriptionBenchmarks[
                      benchmarkAcceleration
                    ]!.realtimeFactor,
                ),
              )}
              × snabbare än realtid · används för tidsuppskattningar.
              {settings.localTranscriptionBenchmarks[benchmarkAcceleration]!
                .gpuUsed &&
              settings.localTranscriptionBenchmarks[benchmarkAcceleration]!
                .vramTotalMb
                ? ` NVIDIA bekräftad · ${settings.localTranscriptionBenchmarks[benchmarkAcceleration]!.vramUsedMb ?? "?"}/${settings.localTranscriptionBenchmarks[benchmarkAcceleration]!.vramTotalMb} MB VRAM vid avläsning.`
                : ""}
            </span>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-violet-600" />
          <div>
            <div className="text-sm font-semibold text-slate-800">
              Lokal Whisper
            </div>
            <div className="text-xs text-slate-400">
              Gratis, offline och privat
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3">
          {localModels.map((model) => {
            const installed = statuses[model.id]?.installed;
            return (
              <div
                key={model.id}
                className={`rounded-xl border p-3 text-left transition ${
                  installed
                    ? selected === model.id
                      ? "border-violet-400 bg-violet-50 ring-1 ring-violet-100"
                      : "border-slate-200 bg-white hover:border-slate-300"
                    : "border-slate-200 bg-slate-50 text-slate-400"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs font-semibold ${installed ? "text-slate-700" : "text-slate-400"}`}
                  >
                    {model.name}
                  </span>
                  {installed && (
                    <span className="size-2 rounded-full bg-emerald-500" />
                  )}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {model.size} · {model.hint}
                </div>
                {installed ? (
                  <button
                    type="button"
                    className="mt-3 text-xs font-medium text-violet-700 hover:text-violet-900"
                    onClick={() =>
                      updateSettings({
                        localTranscriptionModel: model.id,
                        transcriptionProvider: "local",
                      })
                    }
                  >
                    {selected === model.id ? "Vald" : "Använd modell"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="mt-3 text-xs font-medium text-violet-600 hover:text-violet-800 disabled:cursor-not-allowed disabled:text-slate-400"
                    onClick={() => void download(model.id)}
                    disabled={working !== null}
                  >
                    {working === model.id ? "Laddar ner…" : "Ladda ner"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-col gap-3 rounded-xl bg-slate-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:py-2">
          <div className="text-xs text-slate-500">
            {statuses[selected]?.installed
              ? `${localModels.find((x) => x.id === selected)?.name} är installerad lokalt`
              : `${localModels.find((x) => x.id === selected)?.name} behöver laddas ner`}
          </div>
          {statuses[selected]?.installed ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void remove(selected)}
              disabled={working === selected}
            >
              <Trash2 className="size-3.5" /> Ta bort
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => void download(selected)}
              disabled={working === selected}
            >
              <DownloadCloud className="size-3.5" />{" "}
              {working === selected ? "Laddar…" : "Ladda ner"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function LocalAiStorageSummary() {
  const [models, setModels] = useState<LocalModelStatus[]>([]);
  const [engine, setEngine] = useState<LocalEngineStatus | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const refresh = async () => {
    const [modelStatuses, engineStatus] = await Promise.all([
      Promise.all(localModels.map((model) => getLocalModelStatus(model.id))),
      getLocalEngineStatus(),
    ]);
    setModels(modelStatuses.filter((model) => model.installed));
    setEngine(engineStatus);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const removeModel = async (model: LocalModel, name: string) => {
    if (
      !confirm(
        `Ta bort Whisper ${name} från datorn? Modellen kan laddas ner igen senare.`,
      )
    )
      return;
    setWorking(model);
    try {
      await removeLocalModel(model);
      await refresh();
      toast.success(`Whisper ${name} togs bort`);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWorking(null);
    }
  };

  const removeGpu = async () => {
    if (
      !confirm(
        "Ta bort NVIDIA-stödet för lokal transkribering? Det kan installeras igen senare.",
      )
    )
      return;
    setWorking("nvidia");
    try {
      await removeNvidiaRuntime();
      await refresh();
      toast.success("NVIDIA-stödet togs bort");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWorking(null);
    }
  };

  const resources = [
    ...models.map((model) => ({
      id: model.model,
      name: `Whisper ${localModels.find((item) => item.id === model.model)?.name ?? model.model}`,
      size: model.size,
      onRemove: () =>
        void removeModel(
          model.model,
          localModels.find((item) => item.id === model.model)?.name ??
            model.model,
        ),
    })),
    ...(engine?.nvidiaRuntimeInstalled
      ? [
          {
            id: "nvidia",
            name: "NVIDIA-stöd för Whisper",
            size: engine.nvidiaRuntimeSize,
            onRemove: () => void removeGpu(),
          },
        ]
      : []),
  ];

  if (!resources.length) return null;

  return (
    <div className="mt-4 border-t border-slate-200 pt-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Lokala AI-resurser
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        Whisper-modeller och acceleratorstöd lagras separat från
        föreläsningsmaterial.
      </p>
      <div className="mt-2 space-y-2">
        {resources.map((resource) => (
          <div
            key={resource.id}
            className="flex items-center justify-between gap-3 text-xs"
          >
            <span className="min-w-0 truncate text-slate-600">
              {resource.name}
            </span>
            <div className="flex shrink-0 items-center gap-2 tabular-nums text-slate-400">
              <span>{formatBytes(resource.size)}</span>
              <button
                type="button"
                className="text-slate-500 hover:text-red-600 disabled:text-slate-300"
                onClick={resource.onRemove}
                disabled={working !== null}
                aria-label={`Ta bort ${resource.name}`}
                title={`Ta bort ${resource.name}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
