import {
  defaultCardGenerationSettings,
  type AppSettings,
  type BackgroundJob,
  type LibraryNode,
} from "../../core/types";
import type {
  CapabilitySnapshot,
  LectioClient,
  LectioEvent,
  LectioResult,
  LibrarySnapshot,
  SessionSnapshot,
} from "../lectioClient";

const ok = <T>(value: T): LectioResult<T> => ({ ok: true, value });
const notFound = (): LectioResult => ({
  ok: false,
  error: {
    code: "not-found",
    messageKey: "lectio.error.not-found",
    message: "Det valda objektet kunde inte hittas.",
  },
});
const emptySettings = (): AppSettings => ({
  locale: "sv",
  onboardingDismissed: true,
  librarySidebarCollapsed: false,
  selectedPaletteId: "chalk-neutral",
  customPalettes: [],
  userContext: "",
  aiMode: "clipboard",
  aiProvider: "openai",
  aiModel: "gpt-4.1-mini",
  aiBaseUrl: "https://api.openai.com/v1",
  cardGeneration: defaultCardGenerationSettings(),
  transcriptionProvider: "local",
  localTranscriptionModel: "base",
  localTranscriptionAcceleration: "auto",
  localTranscriptionBenchmarks: {},
  transcriptionModel: "whisper-1",
  transcriptionBaseUrl: "https://api.openai.com/v1",
  transcriptionPrompt: "",
  localVisualDescriptions: "off",
  ankiUrl: "http://127.0.0.1:8765",
  defaultDeck: "Lectio",
  cloudSync: {
    provider: "google-drive",
    remotePath: "Lectio",
    autoSyncOnStartAndClose: false,
  },
  backupLimit: 10,
});

export function createInMemoryLectioClient(): LectioClient {
  let sequence = 0;
  let library: LibrarySnapshot = {
    nodes: [
      {
        id: "workspace",
        parentId: null,
        type: "workspace",
        title: "Mina studier",
        context: "",
        createdAt: new Date(0).toISOString(),
        settings: {},
      },
    ],
    lectures: {},
    segments: [],
    markers: [],
    cards: [],
  };
  let session: SessionSnapshot = {
    selectedId: "workspace",
    activeView: "dashboard",
  };
  let settings = emptySettings();
  let jobs: BackgroundJob[] = [];
  const libraryListeners = new Set<(value: LibrarySnapshot) => void>();
  const sessionListeners = new Set<(value: SessionSnapshot) => void>();
  const settingsListeners = new Set<(value: AppSettings) => void>();
  const jobListeners = new Set<(value: BackgroundJob[]) => void>();
  const eventListeners = new Set<(event: LectioEvent) => void>();
  const publishLibrary = () => {
    libraryListeners.forEach((listener) => listener(library));
    eventListeners.forEach((listener) =>
      listener({ type: "library-changed", snapshot: library }),
    );
  };
  const publishSession = () => {
    sessionListeners.forEach((listener) => listener(session));
    eventListeners.forEach((listener) =>
      listener({ type: "session-changed", snapshot: session }),
    );
  };

  return {
    runtime: { frontend: "next", dataProfile: "next" },
    library: {
      getSnapshot: () => library,
      subscribe(listener) {
        libraryListeners.add(listener);
        return () => libraryListeners.delete(listener);
      },
      addNode(parentId, type, title) {
        const id = `memory-${++sequence}`;
        const node: LibraryNode = {
          id,
          parentId: parentId ?? "workspace",
          type,
          title,
          context: "",
          createdAt: new Date(sequence).toISOString(),
          settings: {},
        };
        library = {
          ...library,
          nodes: [...library.nodes, node],
          lectures:
            type === "lecture"
              ? { ...library.lectures, [id]: { lectureId: id, notes: "" } }
              : library.lectures,
        };
        publishLibrary();
        return ok(id);
      },
      updateNode(id, patch) {
        library = {
          ...library,
          nodes: library.nodes.map((node) =>
            node.id === id ? { ...node, ...patch } : node,
          ),
        };
        publishLibrary();
        return ok(undefined);
      },
      moveNode(id, parentId) {
        library = {
          ...library,
          nodes: library.nodes.map((node) =>
            node.id === id ? { ...node, parentId } : node,
          ),
        };
        publishLibrary();
        return ok(true);
      },
      reorderNode: () => ok(true),
      async removeNode(id) {
        library = {
          ...library,
          nodes: library.nodes.filter((node) => node.id !== id),
        };
        publishLibrary();
        return ok(undefined);
      },
      updateLecture(id, patch) {
        library = {
          ...library,
          lectures: {
            ...library.lectures,
            [id]: {
              ...(library.lectures[id] ?? { lectureId: id, notes: "" }),
              ...patch,
            },
          },
        };
        publishLibrary();
        return ok(undefined);
      },
      import(data) {
        library = { ...library, ...data };
        if (data.settings) settings = data.settings;
        publishLibrary();
        return ok(undefined);
      },
      restore(backup) {
        library = {
          nodes: backup.nodes,
          lectures: backup.lectures,
          segments: backup.segments,
          markers: backup.markers,
          cards: backup.cards,
        };
        settings = backup.settings;
        publishLibrary();
        return ok(undefined);
      },
    },
    assets: {
      async importAudio(lectureId, input) {
        const id = `memory-asset-${++sequence}`;
        const lecture = library.lectures[lectureId];
        const audioParts = [
          ...(lecture?.audioParts ?? []),
          { assetId: id, name: input.name },
        ];
        library = {
          ...library,
          lectures: {
            ...library.lectures,
            [lectureId]: {
              ...(lecture ?? { lectureId, notes: "" }),
              audioAssetId: audioParts[0]?.assetId,
              audioName: audioParts[0]?.name,
              audioParts,
            },
          },
        };
        publishLibrary();
        return ok(id);
      },
      async importSlides(lectureId, input) {
        const id = `memory-asset-${++sequence}`;
        library = {
          ...library,
          lectures: {
            ...library.lectures,
            [lectureId]: {
              ...(library.lectures[lectureId] ?? { lectureId, notes: "" }),
              slideAssetId: id,
              slideName: input.name,
            },
          },
        };
        publishLibrary();
        return ok(id);
      },
    },
    session: {
      getSnapshot: () => session,
      subscribe(listener) {
        sessionListeners.add(listener);
        return () => sessionListeners.delete(listener);
      },
      selectNode(id) {
        if (!library.nodes.some((node) => node.id === id)) return notFound();
        session = { ...session, selectedId: id };
        publishSession();
        return ok(undefined);
      },
      setActiveView(activeView) {
        session = { ...session, activeView };
        publishSession();
        return ok(undefined);
      },
    },
    settings: {
      getSnapshot: () => settings,
      subscribe(listener) {
        settingsListeners.add(listener);
        return () => settingsListeners.delete(listener);
      },
      update(patch) {
        settings = { ...settings, ...patch };
        settingsListeners.forEach((listener) => listener(settings));
        return ok(undefined);
      },
    },
    transcript: {
      replace(lectureId, segments) {
        library = {
          ...library,
          segments: [
            ...library.segments.filter((item) => item.lectureId !== lectureId),
            ...segments.map((segment) => ({
              ...segment,
              id: `memory-${++sequence}`,
              lectureId,
            })),
          ],
        };
        publishLibrary();
        return ok(undefined);
      },
      updateSegment(id, text) {
        library = {
          ...library,
          segments: library.segments.map((item) =>
            item.id === id ? { ...item, text } : item,
          ),
        };
        publishLibrary();
        return ok(undefined);
      },
      removeSegment(id) {
        library = {
          ...library,
          segments: library.segments.filter((item) => item.id !== id),
        };
        publishLibrary();
        return ok(undefined);
      },
    },
    markers: {
      add(marker) {
        library = {
          ...library,
          markers: [
            ...library.markers,
            {
              ...marker,
              id: `memory-${++sequence}`,
              createdAt: new Date(sequence).toISOString(),
            },
          ],
        };
        publishLibrary();
        return ok(undefined);
      },
      update(id, note) {
        library = {
          ...library,
          markers: library.markers.map((item) =>
            item.id === id ? { ...item, note } : item,
          ),
        };
        publishLibrary();
        return ok(undefined);
      },
      remove(id) {
        library = {
          ...library,
          markers: library.markers.filter((item) => item.id !== id),
        };
        publishLibrary();
        return ok(undefined);
      },
    },
    cards: {
      add(cards) {
        const ids = cards.map(() => `memory-${++sequence}`);
        library = {
          ...library,
          cards: [
            ...library.cards,
            ...cards.map((card, index) => ({ ...card, id: ids[index] })),
          ],
        };
        publishLibrary();
        return ok(ids);
      },
      update(id, patch) {
        library = {
          ...library,
          cards: library.cards.map((item) =>
            item.id === id ? { ...item, ...patch } : item,
          ),
        };
        publishLibrary();
        return ok(undefined);
      },
      remove(id) {
        library = {
          ...library,
          cards: library.cards.filter((item) => item.id !== id),
        };
        publishLibrary();
        return ok(undefined);
      },
      approve(ids) {
        const selected = new Set(ids);
        let count = 0;
        library = {
          ...library,
          cards: library.cards.map((card) => {
            if (!selected.has(card.id)) return card;
            count += 1;
            return { ...card, status: "approved" };
          }),
        };
        publishLibrary();
        return ok(count);
      },
    },
    jobs: {
      getSnapshot: () => jobs,
      subscribe(listener) {
        jobListeners.add(listener);
        return () => jobListeners.delete(listener);
      },
      async cancel(id) {
        jobs = jobs.map((job) =>
          job.id === id ? { ...job, status: "cancelled" } : job,
        );
        jobListeners.forEach((listener) => listener(jobs));
        return ok(undefined);
      },
      dismiss(id) {
        jobs = jobs.filter((job) => job.id !== id);
        jobListeners.forEach((listener) => listener(jobs));
        return ok(undefined);
      },
    },
    workflows: {
      async enqueue(action, lectureIds) {
        const ids = lectureIds.map(() => `memory-job-${++sequence}`);
        jobs = [
          ...jobs,
          ...ids.map((id, index) => ({
            id,
            kind:
              action === "transcribe"
                ? ("transcription" as const)
                : ("library" as const),
            label: action,
            phase: "queued",
            status: "queued" as const,
            current: 0,
            startedAt: new Date(sequence + index).toISOString(),
            updatedAt: new Date(sequence + index).toISOString(),
          })),
        ];
        jobListeners.forEach((listener) => listener(jobs));
        return ok(ids);
      },
      async syncLibrary() {
        return ok(undefined);
      },
      async createBackup() {
        return ok(`memory-backup-${++sequence}`);
      },
      async exportDiagnostics() {
        return ok(undefined);
      },
    },
    capabilities: {
      async get(): Promise<CapabilitySnapshot> {
        return {
          desktop: false,
          gpu: "none",
          localTranscription: true,
          ankiConfigured: true,
          driveConnected: false,
          credentialStore: false,
        };
      },
    },
    nativeWindow: {
      async minimize() {
        return ok(undefined);
      },
      async toggleMaximize() {
        return ok(undefined);
      },
      async close() {
        return ok(undefined);
      },
    },
    events: {
      subscribe(listener) {
        eventListeners.add(listener);
        return () => eventListeners.delete(listener);
      },
    },
  };
}
