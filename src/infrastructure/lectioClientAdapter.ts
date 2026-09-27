import type {
  AppSettings,
  BackgroundJob,
  CapabilitySnapshot,
  LectioClient,
  LectioError,
  LectioErrorCode,
  LectioEvent,
  LectioResult,
  LibrarySnapshot,
  ModelCatalogTask,
  SessionSnapshot,
} from "../application/lectioClient";
import { useJobStore } from "./jobStore";
import { libraryRepository } from "./libraryRepository";
import { DATA_PROFILE, FRONTEND_VARIANT } from "../runtimeProfile";
import { isTauri } from "../services/platform";

const listeners = new Set<(event: LectioEvent) => void>();
let stopBatchJobTracking: (() => void) | undefined;
let batchJobTrackingPromise: Promise<void> | undefined;
const dismissedBatchJobIds = new Set<string>();
const activeTrackedJobIds = new Set<string>();

async function trackBatchJobs() {
  if (stopBatchJobTracking) return;
  if (batchJobTrackingPromise) return batchJobTrackingPromise;
  batchJobTrackingPromise = (async () => {
    const { subscribeBatchJobs } = await import("../services/batchActions");
    stopBatchJobTracking = subscribeBatchJobs((batchJobs) => {
      const knownIds = new Set(batchJobs.map((job) => job.id));
      for (const id of dismissedBatchJobIds)
        if (!knownIds.has(id)) dismissedBatchJobIds.delete(id);
      for (const job of batchJobs) {
        if (job.status === "running" || job.status === "waiting")
          dismissedBatchJobIds.delete(job.id);
        if (dismissedBatchJobIds.has(job.id)) continue;
        const status: BackgroundJob["status"] =
          job.status === "running"
            ? "active"
            : job.status === "waiting"
              ? "queued"
              : job.status;
        useJobStore.getState().upsertJob({
          id: job.id,
          kind: job.action === "transcribe" ? "transcription" : "anki",
          label: `${
            job.action === "transcribe"
              ? "Transkriberar"
              : job.action === "generate"
                ? "Skapar Anki-kort"
                : job.action === "approve"
                  ? "Godkänner Anki-kort"
                  : "Synkar Anki-kort"
          } · ${job.lectureTitle}`,
          phase: job.status,
          status,
          current: job.current ?? (status === "complete" ? 1 : 0),
          total: job.total,
          detail: job.detail,
          cancellable: status === "active" || status === "queued",
          startedAt: job.createdAt,
        });
      }
    });
  })().finally(() => {
    batchJobTrackingPromise = undefined;
  });
  return batchJobTrackingPromise;
}

function installProgressBridge() {
  if (typeof window === "undefined") return;
  const upsert = (
    payload: Omit<BackgroundJob, "startedAt" | "updatedAt"> & {
      startedAt?: string;
    },
  ) => useJobStore.getState().upsertJob(payload);
  window.addEventListener("lectio:stability-progress", (event) => {
    if (event instanceof CustomEvent)
      upsert(event.detail as Parameters<typeof upsert>[0]);
  });
  if (isTauri()) {
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<Parameters<typeof upsert>[0]>("lectio:progress", (event) =>
        upsert(event.payload),
      ),
    );
  }
}

installProgressBridge();

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

async function trackProgress<T>(
  kind: BackgroundJob["kind"],
  label: string,
  phase: string,
  work: (
    reportProgress: (progress: {
      completed: number;
      total?: number;
      detail: string;
    }) => void,
  ) => Promise<T>,
  id = `tracked:${kind}:${crypto.randomUUID()}`,
): Promise<T> {
  if (activeTrackedJobIds.has(id))
    throw new Error("Den här uppgiften körs redan.");
  activeTrackedJobIds.add(id);
  // Reusing a stable task id should begin a fresh visible lifecycle.
  useJobStore.getState().dismissJob(id);
  const update = (
    patch: Partial<
      Pick<BackgroundJob, "phase" | "status" | "current" | "total" | "detail">
    >,
  ) =>
    useJobStore.getState().upsertJob({
      id,
      kind,
      label,
      phase,
      status: "active",
      current: 0,
      cancellable: false,
      ...patch,
    });
  update({ phase, detail: "Förbereder…" });
  try {
    const result = await work(({ completed, total, detail }) =>
      update({ current: completed, total, detail }),
    );
    const latest = useJobStore.getState().jobs.find((job) => job.id === id);
    update({
      phase: "complete",
      status: "complete",
      current: latest?.total ?? latest?.current ?? 1,
      total: latest?.total ?? 1,
      detail: "Klart",
    });
    return result;
  } catch (error) {
    update({
      phase: "error",
      status: "error",
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    activeTrackedJobIds.delete(id);
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
    reorderNode: (id, targetId, position = "before") =>
      command(
        () => libraryRepository.getState().reorderNode(id, targetId, position),
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
    read: (id) =>
      asyncCommand(async () => {
        const { db } = await import("../core/database");
        const asset = await db.assets.get(id);
        if (!asset) throw new Error("Filen kunde inte hittas");
        return asset.blob;
      }, "Filen kunde inte öppnas."),
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
    removeAudio: (lectureId, assetId) =>
      asyncCommand(async () => {
        const { db } = await import("../core/database");
        const lecture = libraryRepository.getState().lectures[lectureId];
        if (!lecture) throw new Error("Föreläsningen kunde inte hittas");
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
        if (!previous.some((part) => part.assetId === assetId))
          throw new Error("Ljudfilen kunde inte hittas");
        const audioParts = previous.filter((part) => part.assetId !== assetId);
        await db.assets.delete(assetId);
        libraryRepository.getState().updateLecture(lectureId, {
          audioAssetId: audioParts[0]?.assetId,
          audioName: audioParts[0]?.name,
          audioDuration: audioParts.reduce(
            (total, part) => total + (part.duration ?? 0),
            0,
          ),
          audioParts,
        });
      }, "Ljudfilen kunde inte tas bort."),
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
          slidePageSplits: undefined,
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
          const pages = await extractPdfPages(blob, { ocr: false });
          patch.slidePages = pages;
          patch.slideText = formatSlideText(pages);
        }
        libraryRepository.getState().updateLecture(lectureId, patch);
        return id;
      }, "Slides kunde inte importeras."),
  },
  visuals: {
    indexLecture: (lectureId, progress) =>
      asyncCommand(async () => {
        const lecture = libraryRepository.getState().lectures[lectureId];
        if (!lecture?.slideAssetId) throw new Error("Lägg till slides först.");
        const title =
          libraryRepository
            .getState()
            .nodes.find((node) => node.id === lectureId)?.title ??
          "föreläsningen";
        return trackProgress(
          "vision",
          `Extraherar bilder · ${title}`,
          "extracting",
          async (reportProgress) => {
            const { buildStoredSlideVisualIndex } =
              await import("../services/visualIndex");
            const indexed = await buildStoredSlideVisualIndex(
              lecture,
              (current, total, detail) => {
                const update = { completed: current, total, detail };
                progress?.(update);
                reportProgress(update);
              },
            );
            if (!indexed) throw new Error("Slides kunde inte analyseras.");
            const deleted = new Set(lecture.deletedVisualIds ?? []);
            const existingVision = new Map(
              (lecture.visualIndex ?? []).map((item) => [
                item.id,
                item.localVision,
              ]),
            );
            const existingAnalysis = new Map(
              (lecture.visualIndex ?? []).map((item) => [
                item.id,
                item.visualAnalysis,
              ]),
            );
            const candidates = indexed.candidates
              .filter((item) => !deleted.has(item.id))
              .map((item) => ({
                ...item,
                localVision: existingVision.get(item.id),
                visualAnalysis: existingAnalysis.get(item.id),
              }));
            if (candidates.length || !lecture.visualIndex?.length) {
              libraryRepository.getState().updateLecture(lectureId, {
                visualIndex: candidates,
                visualIndexHash: indexed.sourceHash,
                visualIndexVersion: 2,
                visualIndexUpdatedAt: new Date().toISOString(),
              });
            }
            return candidates.length;
          },
          `visual-index:${lectureId}`,
        );
      }, "Slidebilderna kunde inte extraheras."),
    describeLecture: (lectureId, progress) =>
      asyncCommand(async () => {
        const { settings } = libraryRepository.getState();
        if (settings.visualAnalysisProvider !== "api")
          throw new Error("Välj API som bildanalysmetod i inställningarna.");
        const apiKey = await (
          await import("../services/credentials")
        ).readCredential("visual:openai");
        if (!apiKey)
          throw new Error(
            "Spara en OpenAI-nyckel under Inställningar → Bildanalys först.",
          );
        const lecture = libraryRepository.getState().lectures[lectureId];
        const candidates = lecture?.visualIndex ?? [];
        if (!lecture || !candidates.length)
          throw new Error(
            "Extrahera bilder från slides innan du beskriver dem.",
          );
        const title =
          libraryRepository
            .getState()
            .nodes.find((node) => node.id === lectureId)?.title ??
          "föreläsningen";
        return trackProgress(
          "vision",
          `Beskriver bilder · ${title}`,
          "analyzing",
          async (reportProgress) => {
            const { analyzeVisualCrop } =
              await import("../services/apiVisualAnalysis");
            const { resolveVisualDescriptionImage } =
              await import("../services/visualIndex");
            const pending = candidates.filter(
              (candidate) =>
                candidate.visualAnalysis?.provider !== "openai" ||
                candidate.visualAnalysis.model !==
                  settings.visualAnalysisModel ||
                candidate.visualAnalysis.sourceHash !== candidate.sourceHash,
            );
            let completed = 0;
            for (const candidate of pending) {
              progress?.({
                completed,
                total: pending.length,
                detail: `Skickar bildutklipp ${completed + 1} av ${pending.length} till OpenAI…`,
              });
              reportProgress({
                completed,
                total: pending.length,
                detail: `Skickar bildutklipp ${completed + 1} av ${pending.length} till OpenAI…`,
              });
              const currentLecture =
                libraryRepository.getState().lectures[lectureId];
              const currentCandidate = currentLecture?.visualIndex?.find(
                (item) => item.id === candidate.id,
              );
              if (!currentLecture || !currentCandidate) continue;
              const image = await resolveVisualDescriptionImage(
                currentCandidate,
                currentLecture,
              );
              if (!image)
                throw new Error(
                  `Bildutklipp från slide ${candidate.slidePage} kunde inte öppnas.`,
                );
              const result = await analyzeVisualCrop(image, {
                apiKey,
                model: settings.visualAnalysisModel,
                localOcrText: currentCandidate.cropText,
              });
              const latest = libraryRepository.getState().lectures[lectureId];
              if (latest?.visualIndex) {
                libraryRepository.getState().updateLecture(lectureId, {
                  visualIndex: latest.visualIndex.map((item) =>
                    item.id === candidate.id
                      ? {
                          ...item,
                          visualAnalysis: {
                            ...result,
                            provider: "openai",
                            model: settings.visualAnalysisModel,
                            generatedAt: new Date().toISOString(),
                            sourceHash: item.sourceHash,
                          },
                        }
                      : item,
                  ),
                });
              }
              completed += 1;
              progress?.({
                completed,
                total: pending.length,
                detail: `Bildutklipp ${completed} av ${pending.length} klart.`,
              });
              reportProgress({
                completed,
                total: pending.length,
                detail: `Bildutklipp ${completed} av ${pending.length} klart.`,
              });
            }
            return completed;
          },
          `visual-describe:${lectureId}`,
        );
      }, "Bilderna kunde inte analyseras med OpenAI."),
    thumbnail: (lectureId, visualId) =>
      asyncCommand(async () => {
        const lecture = libraryRepository.getState().lectures[lectureId];
        const candidate = lecture?.visualIndex?.find(
          (item) => item.id === visualId,
        );
        if (!lecture || !candidate)
          throw new Error("Bilden kunde inte hittas.");
        const { resolveVisualThumbnail } =
          await import("../services/visualIndex");
        const blob = await resolveVisualThumbnail(candidate, lecture);
        if (!blob) throw new Error("Förhandsvisningen kunde inte skapas.");
        return blob;
      }, "Bilden kunde inte öppnas."),
    remove: (lectureId, visualId) =>
      asyncCommand(async () => {
        const { db } = await import("../core/database");
        const lecture = libraryRepository.getState().lectures[lectureId];
        if (!lecture) throw new Error("Föreläsningen kunde inte hittas");
        const candidate = lecture.visualIndex?.find(
          (item) => item.id === visualId,
        );
        await db.visualThumbnails.where("visualId").equals(visualId).delete();
        if (candidate?.assetId && candidate.assetId !== lecture.slideAssetId)
          await db.assets.delete(candidate.assetId);
        libraryRepository.getState().updateLecture(lectureId, {
          visualIndex: (lecture.visualIndex ?? []).filter(
            (item) => item.id !== visualId,
          ),
          deletedVisualIds: [
            ...new Set([...(lecture.deletedVisualIds ?? []), visualId]),
          ],
        });
      }, "Bilden kunde inte tas bort."),
  },
  inbox: {
    list: () =>
      asyncCommand(async () => {
        const { listGoogleDriveInbox } =
          await import("../services/googleDriveInbox");
        return listGoogleDriveInbox();
      }, "Google Drive-inkorgen kunde inte läsas."),
    import: (files, lectureId, progress) =>
      asyncCommand(async () => {
        const { importGoogleDriveInboxFiles } =
          await import("../services/googleDriveInbox");
        const title =
          libraryRepository
            .getState()
            .nodes.find((node) => node.id === lectureId)?.title ??
          "föreläsningen";
        return trackProgress(
          "library",
          `Importerar ljud till ${title}`,
          "importing",
          async (reportProgress) =>
            importGoogleDriveInboxFiles(files, lectureId, (value) => {
              progress?.(value);
              reportProgress(value);
            }),
        );
      }, "Ljudfilerna kunde inte importeras från Google Drive."),
  },
  recordings: {
    start: (lectureId, mimeType) =>
      asyncCommand(async () => {
        const { startRecording } = await import("../services/lectureRecording");
        return startRecording(lectureId, mimeType);
      }, "Inspelningen kunde inte startas."),
    append: (id, sequence, blob, duration) =>
      asyncCommand(async () => {
        const { appendRecording } =
          await import("../services/lectureRecording");
        await appendRecording(id, sequence, blob, duration);
      }, "Ljuddelen kunde inte sparas. Inspelningen har stoppats."),
    finish: (id, duration) =>
      asyncCommand(async () => {
        const { finishRecording } =
          await import("../services/lectureRecording");
        return finishRecording(id, duration);
      }, "Inspelningen kunde inte slutföras. Sparade ljuddelar finns kvar."),
    pending: (lectureId) =>
      asyncCommand(async () => {
        const { db } = await import("../core/database");
        return (
          await db.recordingSessions
            .where("lectureId")
            .equals(lectureId)
            .toArray()
        ).map(({ id, name }) => ({ id, name }));
      }, "Sparade inspelningar kunde inte läsas."),
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
  credentials: {
    read: (key) =>
      asyncCommand(async () => {
        const { readCredential } = await import("../services/credentials");
        return Boolean(await readCredential(key));
      }, "Den sparade API-nyckeln kunde inte läsas."),
    write: (key, secret) =>
      asyncCommand(async () => {
        const { writeCredential } = await import("../services/credentials");
        await writeCredential(key, secret);
      }, "API-nyckeln kunde inte sparas säkert."),
    remove: (key) =>
      asyncCommand(async () => {
        const { deleteCredential } = await import("../services/credentials");
        await deleteCredential(key);
      }, "API-nyckeln kunde inte tas bort."),
  },
  modelCatalog: {
    list: (task: ModelCatalogTask) =>
      asyncCommand(async () => {
        const settings = libraryRepository.getState().settings;
        const { fetchProviderModelOptions } =
          await import("../services/modelCatalog");
        const { readCredential } = await import("../services/credentials");
        let provider: "openai" | "anthropic" | "gemini" | "groq" | "custom";
        let credentialKey: string;
        let baseUrl: string;
        if (task === "cards") {
          provider = settings.aiProvider;
          credentialKey = `ai:${provider}`;
          baseUrl = settings.aiBaseUrl;
        } else if (task === "transcription") {
          if (
            settings.transcriptionProvider !== "openai" &&
            settings.transcriptionProvider !== "groq"
          )
            throw new Error("Välj en API-leverantör först.");
          provider = settings.transcriptionProvider;
          credentialKey = `transcription:${provider}`;
          baseUrl = settings.transcriptionBaseUrl;
        } else {
          provider = "openai";
          credentialKey = "visual:openai";
          baseUrl = "https://api.openai.com/v1";
        }
        const apiKey = await readCredential(credentialKey);
        return fetchProviderModelOptions(provider, apiKey, baseUrl, task);
      }, "Modellförslagen kunde inte hämtas."),
  },
  localTranscription: {
    status: (model) =>
      asyncCommand(async () => {
        const { getLocalEngineStatus, getLocalModelStatus } =
          await import("../services/localStt");
        const [engine, selected] = await Promise.all([
          getLocalEngineStatus(),
          getLocalModelStatus(model),
        ]);
        return {
          model,
          installed: selected.installed,
          size: selected.size,
          nvidiaDetected: engine.nvidiaDetected,
          nvidiaRuntimeInstalled: engine.nvidiaRuntimeInstalled,
          nvidiaRuntimeReady: engine.nvidiaRuntimeReady,
          nvidiaName: engine.nvidiaName,
        };
      }, "Den lokala transkriptionsmotorn kunde inte kontrolleras."),
    download: (model) =>
      asyncCommand(async () => {
        const { downloadLocalModel, getLocalEngineStatus } =
          await import("../services/localStt");
        const selected = await downloadLocalModel(model);
        const engine = await getLocalEngineStatus();
        return {
          model,
          installed: selected.installed,
          size: selected.size,
          nvidiaDetected: engine.nvidiaDetected,
          nvidiaRuntimeInstalled: engine.nvidiaRuntimeInstalled,
          nvidiaRuntimeReady: engine.nvidiaRuntimeReady,
          nvidiaName: engine.nvidiaName,
        };
      }, "Whisper-modellen kunde inte laddas ned."),
    remove: (model) =>
      asyncCommand(async () => {
        const { removeLocalModel } = await import("../services/localStt");
        await removeLocalModel(model);
      }, "Whisper-modellen kunde inte tas bort."),
    installNvidia: () =>
      asyncCommand(async () => {
        const { getLocalModelStatus, installNvidiaRuntime } =
          await import("../services/localStt");
        const engine = await installNvidiaRuntime();
        const model =
          libraryRepository.getState().settings.localTranscriptionModel;
        const selected = await getLocalModelStatus(model);
        return {
          model,
          installed: selected.installed,
          size: selected.size,
          nvidiaDetected: engine.nvidiaDetected,
          nvidiaRuntimeInstalled: engine.nvidiaRuntimeInstalled,
          nvidiaRuntimeReady: engine.nvidiaRuntimeReady,
          nvidiaName: engine.nvidiaName,
        };
      }, "NVIDIA-stödet kunde inte installeras."),
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
    upsert: (job) =>
      command(
        () => useJobStore.getState().upsertJob(job),
        "Jobbstatusen kunde inte uppdateras.",
      ),
    cancel: async (id) =>
      asyncCommand(async () => {
        const job = useJobStore.getState().jobs.find((item) => item.id === id);
        if (!job) return;
        if (job.cancellable === false)
          throw new Error("Den här uppgiften kan inte avbrytas här.");
        if (job.kind === "transcription" || job.kind === "anki") {
          const [
            { cancelBatchJob },
            { cancelActiveTranscription, cancelQueuedTranscription },
            { cancelLocalTranscription },
          ] = await Promise.all([
            import("../services/batchActions"),
            import("../services/transcriptionQueue"),
            import("../services/localStt"),
          ]);
          cancelQueuedTranscription(id);
          cancelActiveTranscription(id);
          await Promise.allSettled([
            cancelBatchJob(id),
            cancelLocalTranscription(id),
          ]);
        } else if (job.kind === "vision") {
          const { cancelActiveVision, cancelQueuedVision } =
            await import("../services/visualDescriptionQueue");
          cancelQueuedVision(id);
          cancelActiveVision(id);
        } else if (job.kind === "download") {
          const { cancelDownload } = await import("../services/localStt");
          await cancelDownload(id);
        } else if (job.kind === "library") {
          const { cancelQueuedSlideIndex } =
            await import("../services/slideIndexQueue");
          cancelQueuedSlideIndex(id);
        }
      }, "Jobbet kunde inte avbrytas."),
    dismiss: (id) =>
      command(() => {
        if (id.startsWith("batch:")) dismissedBatchJobIds.add(id);
        useJobStore.getState().dismissJob(id);
      }, "Jobbet kunde inte döljas."),
  },
  notifications: {
    getSnapshot: () => useJobStore.getState().notifications,
    subscribe: (listener) =>
      useJobStore.subscribe((state, previous) => {
        if (state.notifications !== previous.notifications)
          listener(state.notifications);
      }),
    push: (notification) =>
      command(() => {
        const id = notification.id ?? crypto.randomUUID();
        useJobStore.getState().pushNotification({ ...notification, id });
        return id;
      }, "Notisen kunde inte visas."),
    dismiss: (id) =>
      command(
        () => useJobStore.getState().dismissNotification(id),
        "Notisen kunde inte stängas.",
      ),
  },
  workflows: {
    exportLibrary: (progress) =>
      asyncCommand(async () => {
        const { exportLibrary } = await import("../services/libraryTransfer");
        await trackProgress(
          "library",
          "Exporterar bibliotek",
          "exporting",
          async (reportProgress) =>
            exportLibrary((value) => {
              progress?.(value);
              reportProgress(value);
            }),
        );
      }, "Biblioteket kunde inte exporteras."),
    importLibraryFile: (file, name, progress) =>
      asyncCommand(async () => {
        const { importLibraryFile } =
          await import("../services/libraryTransfer");
        await trackProgress(
          "library",
          `Importerar ${name}`,
          "importing",
          async (reportProgress) =>
            importLibraryFile(file, name, (value) => {
              progress?.(value);
              reportProgress(value);
            }),
        );
      }, "Biblioteket kunde inte importeras."),
    listBackups: () =>
      asyncCommand(async () => {
        const { listLibraryBackups } =
          await import("../services/libraryTransfer");
        return listLibraryBackups();
      }, "Återställningspunkterna kunde inte läsas."),
    restoreBackup: (id) =>
      asyncCommand(async () => {
        const { restoreLibraryCheckpoint } =
          await import("../services/libraryTransfer");
        await restoreLibraryCheckpoint(id);
      }, "Biblioteket kunde inte återställas."),
    enqueue: async (action, lectureIds, overwrite = false) =>
      asyncCommand(async () => {
        const nodes = libraryRepository.getState().nodes;
        const lectures = lectureIds.flatMap((id) => {
          const node = nodes.find((candidate) => candidate.id === id);
          return node?.type === "lecture" ? [{ id, title: node.title }] : [];
        });
        if (!lectures.length) throw new Error("Inga föreläsningar hittades");
        await trackBatchJobs();
        const { enqueueBatch } = await import("../services/batchActions");
        return enqueueBatch(action, lectures, overwrite).map((job) => job.id);
      }, "Åtgärderna kunde inte läggas i kö."),
    syncLibrary: () =>
      asyncCommand(async () => {
        const { syncGoogleDrive } = await import("../services/googleDriveSync");
        await syncGoogleDrive();
      }, "Biblioteket kunde inte synkas."),
    connectGoogleDrive: () =>
      asyncCommand(async () => {
        const { connectGoogleDrive } = await import("../services/sync");
        const connection = await connectGoogleDrive();
        const state = libraryRepository.getState();
        state.updateSettings({
          cloudSync: {
            ...state.settings.cloudSync,
            accountLabel: connection.accountLabel,
            connectedAt: new Date().toISOString(),
          },
        });
        return { accountLabel: connection.accountLabel };
      }, "Google Drive kunde inte anslutas."),
    cancelGoogleDriveConnection: () =>
      asyncCommand(async () => {
        const { cancelGoogleDriveConnection } =
          await import("../services/sync");
        return cancelGoogleDriveConnection();
      }, "Google-inloggningen kunde inte avbrytas."),
    disconnectGoogleDrive: () =>
      asyncCommand(async () => {
        const { disconnectGoogleDrive } = await import("../services/sync");
        await disconnectGoogleDrive();
        const state = libraryRepository.getState();
        state.updateSettings({
          cloudSync: {
            ...state.settings.cloudSync,
            accountLabel: undefined,
            connectedAt: undefined,
            lastSyncedAt: undefined,
          },
        });
      }, "Google Drive kunde inte kopplas bort."),
    testAnki: () =>
      asyncCommand(async () => {
        const { getDecks, testAnki } = await import("../services/anki");
        const url = libraryRepository.getState().settings.ankiUrl;
        const version = await testAnki(url);
        const decks = await getDecks(url);
        return { version, decks };
      }, "Anki kunde inte nås. Kontrollera att Anki och AnkiConnect är öppna."),
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
