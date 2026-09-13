import type {
  AppSettings,
  CapabilitySnapshot,
  LectioClient,
  LectioError,
  LectioErrorCode,
  LectioEvent,
  LectioResult,
  LibrarySnapshot,
  SessionSnapshot,
} from "../application/lectioClient";
import { useJobStore } from "./jobStore";
import { libraryRepository } from "./libraryRepository";
import { DATA_PROFILE, FRONTEND_VARIANT } from "../runtimeProfile";
import { isTauri } from "../services/platform";

const listeners = new Set<(event: LectioEvent) => void>();

function publish(event: LectioEvent) {
  listeners.forEach((listener) => listener(event));
}

if (typeof window !== "undefined") {
  for (const state of ["focus", "blur", "online", "offline"] as const)
    window.addEventListener(state, () =>
      publish({ type: "native-lifecycle", state }),
    );
}

function librarySnapshot(): LibrarySnapshot {
  const state = libraryRepository.getState();
  return {
    nodes: state.nodes,
    lectures: state.lectures,
    segments: state.segments,
    markers: state.markers,
    cards: state.cards,
  };
}

function sessionSnapshot(): SessionSnapshot {
  const { selectedId, activeView } = libraryRepository.getState();
  return { selectedId, activeView };
}

function errorCode(error: unknown): LectioErrorCode {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("avbr") || message.includes("cancel"))
    return "cancelled";
  if (message.includes("hitta") || message.includes("not found"))
    return "not-found";
  if (message.includes("placeras") || message.includes("ogilt"))
    return "invalid-input";
  if (message.includes("lagr") || message.includes("quota"))
    return "storage-error";
  if (message.includes("provider") || message.includes("api"))
    return "provider-error";
  return "unknown";
}

function safeError(error: unknown, fallback: string): LectioError {
  const code = errorCode(error);
  const messageByCode: Record<LectioErrorCode, string> = {
    "invalid-input": "Kontrollera uppgifterna och försök igen.",
    "not-found": "Det valda objektet kunde inte hittas.",
    conflict: "Ändringen krockar med en annan pågående ändring.",
    "capability-unavailable":
      "Funktionen är inte tillgänglig på den här enheten.",
    cancelled: "Åtgärden avbröts.",
    "provider-error": "Den anslutna tjänsten kunde inte slutföra åtgärden.",
    "storage-error": "Lectio kunde inte spara ändringen lokalt.",
    unknown: fallback,
  };
  return {
    code,
    messageKey: `lectio.error.${code}`,
    message: messageByCode[code],
  };
}

function report(error: unknown, fallback: string): LectioError {
  const normalized = safeError(error, fallback);
  publish({ type: "error", error: normalized });
  void import("../services/diagnostics").then(({ recordDiagnostic }) =>
    recordDiagnostic("application", error),
  );
  return normalized;
}

function command<T>(work: () => T, fallback: string): LectioResult<T> {
  try {
    return { ok: true, value: work() };
  } catch (error) {
    return { ok: false, error: report(error, fallback) };
  }
}

async function asyncCommand<T>(
  work: () => Promise<T>,
  fallback: string,
): Promise<LectioResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error: report(error, fallback) };
  }
}

let previousLibrary = librarySnapshot();
let previousSession = sessionSnapshot();
let previousSettings = libraryRepository.getState().settings;

libraryRepository.subscribe((state) => {
  const nextLibrary = librarySnapshot();
  if (
    state.nodes !== previousLibrary.nodes ||
    state.lectures !== previousLibrary.lectures ||
    state.segments !== previousLibrary.segments ||
    state.markers !== previousLibrary.markers ||
    state.cards !== previousLibrary.cards
  ) {
    previousLibrary = nextLibrary;
    publish({ type: "library-changed", snapshot: nextLibrary });
  }
  if (
    state.selectedId !== previousSession.selectedId ||
    state.activeView !== previousSession.activeView
  ) {
    previousSession = sessionSnapshot();
    publish({ type: "session-changed", snapshot: previousSession });
  }
  if (state.settings !== previousSettings) {
    previousSettings = state.settings;
    publish({ type: "settings-changed", settings: state.settings });
  }
});

useJobStore.subscribe((state, previous) => {
  if (state.jobs !== previous.jobs)
    publish({ type: "jobs-changed", jobs: state.jobs });
});

async function nativeWindowCommand(
  action: "minimize" | "toggleMaximize" | "close",
) {
  if (!isTauri())
    return {
      ok: false,
      error: {
        code: "capability-unavailable",
        messageKey: "lectio.error.capability-unavailable",
        message: "Fönsterkommandot är bara tillgängligt i desktopappen.",
      },
    } satisfies LectioResult;
  return asyncCommand(async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow()[action]();
  }, "Fönsteråtgärden kunde inte genomföras.");
}

export const lectioClient: LectioClient = {
  runtime: { frontend: FRONTEND_VARIANT, dataProfile: DATA_PROFILE },
  library: {
    getSnapshot: () => previousLibrary,
    subscribe(listener) {
      const receive = (event: LectioEvent) => {
        if (event.type === "library-changed") listener(event.snapshot);
      };
      listeners.add(receive);
      return () => listeners.delete(receive);
    },
    addNode: (parentId, type, title) =>
      command(
        () => libraryRepository.getState().addNode(parentId, type, title),
        "Objektet kunde inte skapas.",
      ),
    updateNode: (id, patch) =>
      command(
        () => libraryRepository.getState().updateNode(id, patch),
        "Objektet kunde inte uppdateras.",
      ),
    moveNode: (id, parentId) =>
      command(
        () => libraryRepository.getState().moveNode(id, parentId),
        "Objektet kunde inte flyttas.",
      ),
    reorderNode: (id, targetId) =>
      command(
        () => libraryRepository.getState().reorderNode(id, targetId),
        "Objektet kunde inte sorteras om.",
      ),
    removeNode: async (id) =>
      asyncCommand(async () => {
        libraryRepository.getState().removeNode(id);
      }, "Objektet kunde inte tas bort."),
    updateLecture: (id, patch) =>
      command(
        () => libraryRepository.getState().updateLecture(id, patch),
        "Föreläsningen kunde inte uppdateras.",
      ),
    import: (data) =>
      command(
        () => libraryRepository.getState().importLibrary(data),
        "Biblioteket kunde inte importeras.",
      ),
    restore: (backup) =>
      command(
        () => libraryRepository.getState().restoreLibraryBackup(backup),
        "Säkerhetskopian kunde inte återställas.",
      ),
  },
  assets: {
    importAudio: (lectureId, input) =>
      asyncCommand(async () => {
        const [{ db }, { uid }, audio] = await Promise.all([
          import("../core/database"),
          import("../lib/utils"),
          import("../services/audioImport"),
        ]);
        if (!libraryRepository.getState().lectures[lectureId])
          throw new Error("Föreläsningen kunde inte hittas");
        const file = new File([input.bytes], input.name, {
          type: input.mimeType,
          lastModified: input.lastModified,
        });
        const validation = audio.validateAudioFile(file);
        if (validation) throw new Error(validation);
        const id = uid();
        const duration = await audio.measureAudioDuration(file);
        const sourceFingerprint = audio.audioFingerprint(file);
        await db.assets.put({
          id,
          lectureId,
          kind: "audio",
          name: input.name,
          mimeType: audio.audioMimeType(file),
          blob: file,
          sourceFingerprint,
          createdAt: new Date().toISOString(),
        });
        const lecture = libraryRepository.getState().lectures[lectureId];
        const previous = lecture.audioParts?.length
          ? lecture.audioParts
          : lecture.audioAssetId
            ? [
                {
                  assetId: lecture.audioAssetId,
                  name: lecture.audioName ?? "Ljud",
                  duration: lecture.audioDuration,
                },
              ]
            : [];
        const audioParts = [
          ...previous,
          { assetId: id, name: input.name, duration, sourceFingerprint },
        ];
        libraryRepository.getState().updateLecture(lectureId, {
          audioAssetId: audioParts[0]?.assetId,
          audioName: audioParts[0]?.name,
          audioDuration: audioParts.reduce(
            (total, part) => total + (part.duration ?? 0),
            0,
          ),
          audioParts,
        });
        return id;
      }, "Ljudfilen kunde inte importeras."),
    importSlides: (lectureId, input) =>
      asyncCommand(async () => {
        const [{ db }, { uid }] = await Promise.all([
          import("../core/database"),
          import("../lib/utils"),
        ]);
        if (!libraryRepository.getState().lectures[lectureId])
          throw new Error("Föreläsningen kunde inte hittas");
        const id = uid();
        const blob = new Blob([input.bytes], { type: input.mimeType });
        await db.assets.put({
          id,
          lectureId,
          kind: "slides",
          name: input.name,
          mimeType: input.mimeType,
          blob,
          createdAt: new Date().toISOString(),
        });
        const patch: Parameters<
          ReturnType<typeof libraryRepository.getState>["updateLecture"]
        >[1] = {
          slideAssetId: id,
          slideName: input.name,
          slideText: undefined,
          slidePages: undefined,
          visualIndex: undefined,
          visualIndexHash: undefined,
          visualIndexUpdatedAt: undefined,
        };
        if (
          input.mimeType === "application/pdf" ||
          input.name.toLowerCase().endsWith(".pdf")
        ) {
          const { extractPdfPages, formatSlideText } =
            await import("../services/pdf");
          const pages = await extractPdfPages(blob);
          patch.slidePages = pages;
          patch.slideText = formatSlideText(pages);
        }
        libraryRepository.getState().updateLecture(lectureId, patch);
        return id;
      }, "Slides kunde inte importeras."),
  },
  session: {
    getSnapshot: () => previousSession,
    subscribe(listener) {
      const receive = (event: LectioEvent) => {
        if (event.type === "session-changed") listener(event.snapshot);
      };
      listeners.add(receive);
      return () => listeners.delete(receive);
    },
    selectNode: (id) =>
      command(() => {
        if (!libraryRepository.getState().nodes.some((node) => node.id === id))
          throw new Error("Objektet kunde inte hittas");
        libraryRepository.getState().selectNode(id);
      }, "Objektet kunde inte väljas."),
    setActiveView: (view) =>
      command(
        () => libraryRepository.getState().setActiveView(view),
        "Vyn kunde inte öppnas.",
      ),
  },
  settings: {
    getSnapshot: () => libraryRepository.getState().settings,
    subscribe(listener) {
      let previous = libraryRepository.getState().settings;
      return libraryRepository.subscribe((state) => {
        if (state.settings === previous) return;
        previous = state.settings;
        listener(previous);
      });
    },
    update: (patch: Partial<AppSettings>) =>
      command(
        () => libraryRepository.getState().updateSettings(patch),
        "Inställningen kunde inte sparas.",
      ),
  },
  transcript: {
    replace: (lectureId, segments) =>
      command(
        () => libraryRepository.getState().setSegments(lectureId, segments),
        "Transkriptet kunde inte sparas.",
      ),
    updateSegment: (id, text) =>
      command(
        () => libraryRepository.getState().updateSegment(id, text),
        "Transkriptsegmentet kunde inte uppdateras.",
      ),
    removeSegment: (id) =>
      command(
        () => libraryRepository.getState().removeSegment(id),
        "Transkriptsegmentet kunde inte tas bort.",
      ),
  },
  markers: {
    add: (marker) =>
      command(
        () => libraryRepository.getState().addMarker(marker),
        "Markeringen kunde inte skapas.",
      ),
    update: (id, note) =>
      command(
        () => libraryRepository.getState().updateMarker(id, note),
        "Markeringen kunde inte uppdateras.",
      ),
    remove: (id) =>
      command(
        () => libraryRepository.getState().removeMarker(id),
        "Markeringen kunde inte tas bort.",
      ),
  },
  cards: {
    add: (cards) =>
      command(
        () => libraryRepository.getState().addCards(cards),
        "Korten kunde inte läggas till.",
      ),
    update: (id, patch) =>
      command(
        () => libraryRepository.getState().updateCard(id, patch),
        "Kortet kunde inte uppdateras.",
      ),
    remove: (id) =>
      command(
        () => libraryRepository.getState().removeCard(id),
        "Kortet kunde inte tas bort.",
      ),
    approve: (ids) =>
      command(() => {
        const available = new Set(
          libraryRepository.getState().cards.map((card) => card.id),
        );
        const approved = ids.filter((id) => available.has(id));
        approved.forEach((id) =>
          libraryRepository.getState().updateCard(id, { status: "approved" }),
        );
        return approved.length;
      }, "Korten kunde inte godkännas."),
  },
  jobs: {
    getSnapshot: () => useJobStore.getState().jobs,
    subscribe: (listener) =>
      useJobStore.subscribe((state, previous) => {
        if (state.jobs !== previous.jobs) listener(state.jobs);
      }),
    cancel: async (id) =>
      asyncCommand(async () => {
        const { cancelBatchJob } = await import("../services/batchActions");
        const { cancelLocalTranscription } =
          await import("../services/localStt");
        await Promise.allSettled([
          cancelBatchJob(id),
          cancelLocalTranscription(id),
        ]);
      }, "Jobbet kunde inte avbrytas."),
    dismiss: (id) =>
      command(
        () => useJobStore.getState().dismissJob(id),
        "Jobbet kunde inte döljas.",
      ),
  },
  workflows: {
    enqueue: async (action, lectureIds, overwrite = false) =>
      asyncCommand(async () => {
        const nodes = libraryRepository.getState().nodes;
        const lectures = lectureIds.flatMap((id) => {
          const node = nodes.find((candidate) => candidate.id === id);
          return node?.type === "lecture" ? [{ id, title: node.title }] : [];
        });
        if (!lectures.length) throw new Error("Inga föreläsningar hittades");
        const { enqueueBatch } = await import("../services/batchActions");
        return enqueueBatch(action, lectures, overwrite).map((job) => job.id);
      }, "Åtgärderna kunde inte läggas i kö."),
    syncLibrary: () =>
      asyncCommand(async () => {
        const { syncGoogleDrive } = await import("../services/googleDriveSync");
        await syncGoogleDrive();
      }, "Biblioteket kunde inte synkas."),
    createBackup: () =>
      asyncCommand(async () => {
        const { backupSourceFromState, createLibraryBackup } =
          await import("../services/libraryBackup");
        const backup = await createLibraryBackup(
          "manual",
          backupSourceFromState(libraryRepository.getState()),
        );
        return backup.id;
      }, "Säkerhetskopian kunde inte skapas."),
    exportDiagnostics: () =>
      asyncCommand(async () => {
        const { exportDiagnosticSnapshot } =
          await import("../services/diagnostics");
        await exportDiagnosticSnapshot();
      }, "Diagnostiken kunde inte exporteras."),
  },
  capabilities: {
    get: async (): Promise<CapabilitySnapshot> => {
      const state = libraryRepository.getState();
      try {
        const { getLocalEngineStatus } = await import("../services/localStt");
        const engine = await getLocalEngineStatus();
        return {
          desktop: isTauri(),
          gpu: engine.nvidiaDetected ? "nvidia" : "none",
          localTranscription: true,
          ankiConfigured: Boolean(state.settings.ankiUrl.trim()),
          driveConnected: Boolean(state.settings.cloudSync.connectedAt),
          credentialStore: isTauri(),
        };
      } catch {
        return {
          desktop: isTauri(),
          gpu: "unknown",
          localTranscription: false,
          ankiConfigured: Boolean(state.settings.ankiUrl.trim()),
          driveConnected: Boolean(state.settings.cloudSync.connectedAt),
          credentialStore: isTauri(),
        };
      }
    },
  },
  nativeWindow: {
    minimize: () => nativeWindowCommand("minimize"),
    toggleMaximize: () => nativeWindowCommand("toggleMaximize"),
    close: () => nativeWindowCommand("close"),
  },
  events: {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  },
};
