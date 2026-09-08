import type { CardType, LibraryNode } from "../core/types";
import { db } from "../core/database";
import { useAppStore } from "../core/store";
import { uid } from "../lib/utils";
import {
  createCardPrompt,
  generateCardsWithApi,
  parseCardResponse,
} from "./ai";
import {
  deleteNote,
  ensureDeck,
  lectureDeckName,
  needsAnkiSync,
  syncCard,
  testAnki,
  withoutStructuralTags,
} from "./anki";
import { readCredential } from "./credentials";
import {
  cancelLocalTranscription,
  prepareAudioForCloudTranscription,
  transcribeWithLocalWhisper,
} from "./localStt";
import {
  buildTranscriptionPrompt,
  cloudApiTranscription,
} from "./transcription";
import { inheritedGlossary } from "./glossary";
import { chunkCardCeiling, planGenerationChunks } from "./ankiChunking";
import { runExclusiveTranscription } from "./transcriptionQueue";
import { recordDiagnostic } from "./diagnostics";

export type BatchAction = "transcribe" | "generate" | "approve" | "sync";
export type BatchJobStatus =
  "queued" | "running" | "waiting" | "complete" | "error" | "cancelled";

export type BatchJob = {
  id: string;
  action: BatchAction;
  lectureId: string;
  lectureTitle: string;
  status: BatchJobStatus;
  detail: string;
  createdAt: string;
  updatedAt: string;
  overwrite?: boolean;
};

const storageKey = "lectio-batch-jobs-v1";
let jobs: BatchJob[] = [];
let running = false;
let loaded = false;
const listeners = new Set<(jobs: BatchJob[]) => void>();
const cancelled = new Set<string>();

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const parsed = JSON.parse(
      localStorage.getItem(storageKey) ?? "[]",
    ) as BatchJob[];
    jobs = Array.isArray(parsed)
      ? parsed.map((job) =>
          job.status === "running"
            ? { ...job, status: "queued", detail: "Återupptas efter omstart." }
            : job,
        )
      : [];
  } catch {
    jobs = [];
  }
}

function publish() {
  load();
  localStorage.setItem(storageKey, JSON.stringify(jobs.slice(-250)));
  listeners.forEach((listener) => listener([...jobs]));
}

function patchJob(id: string, patch: Partial<BatchJob>) {
  jobs = jobs.map((job) =>
    job.id === id
      ? { ...job, ...patch, updatedAt: new Date().toISOString() }
      : job,
  );
  publish();
}

export function getBatchJobs() {
  load();
  return jobs;
}

export function subscribeBatchJobs(listener: (value: BatchJob[]) => void) {
  load();
  listeners.add(listener);
  listener([...jobs]);
  return () => {
    listeners.delete(listener);
  };
}

function audioParts(lectureId: string) {
  const lecture = useAppStore.getState().lectures[lectureId];
  if (lecture?.audioParts?.length) return lecture.audioParts;
  return lecture?.audioAssetId
    ? [
        {
          assetId: lecture.audioAssetId,
          name: lecture.audioName ?? "Ljud",
          duration: lecture.audioDuration,
        },
      ]
    : [];
}

async function duration(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<number>((resolve) => {
      const audio = new Audio();
      const finish = (value: number) => {
        audio.removeAttribute("src");
        audio.load();
        resolve(value);
      };
      audio.onloadedmetadata = () =>
        finish(Number.isFinite(audio.duration) ? audio.duration : 0);
      audio.onerror = () => finish(0);
      audio.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function transcribe(job: BatchJob) {
  if (cancelled.has(job.id)) throw new Error("BATCH_CANCELLED");
  const state = useAppStore.getState();
  const parts = audioParts(job.lectureId);
  if (!parts.length) throw new Error("Föreläsningen saknar ljud.");
  const apiMode = state.settings.transcriptionProvider !== "local";
  if (state.settings.transcriptionProvider === "manual")
    throw new Error(
      "Välj lokal transkribering eller en API-provider i inställningarna.",
    );
  const apiKey = apiMode
    ? await readCredential(
        `transcription:${state.settings.transcriptionProvider === "groq" ? "groq" : "openai"}`,
      )
    : "";
  if (apiMode && !apiKey)
    throw new Error("API-nyckeln för transkribering saknas.");
  const prompt = buildTranscriptionPrompt(
    inheritedGlossary(
      state.nodes,
      job.lectureId,
      state.settings.transcriptionPrompt,
    ).terms.join(", "),
  );
  const segments: Array<{
    start: number;
    end: number;
    text: string;
    speaker?: string;
    confidence?: number;
  }> = [];
  const updatedParts = [...parts];
  let offset = 0;
  for (let index = 0; index < parts.length; index++) {
    if (cancelled.has(job.id)) throw new Error("BATCH_CANCELLED");
    patchJob(job.id, {
      detail: `Transkriberar ljuddel ${index + 1} av ${parts.length}…`,
    });
    const asset = await db.assets.get(parts[index].assetId);
    if (!asset) throw new Error("En ljuddel saknas lokalt.");
    let uploads = apiMode
      ? await prepareAudioForCloudTranscription(asset.blob)
      : [asset.blob];
    let partOffset = 0;
    for (const upload of uploads) {
      if (cancelled.has(job.id)) throw new Error("BATCH_CANCELLED");
      const result = apiMode
        ? await cloudApiTranscription.transcribe(
            upload,
            state.settings,
            apiKey!,
            prompt,
          )
        : await transcribeWithLocalWhisper(
            upload,
            state.settings.localTranscriptionModel ?? "base",
            state.settings.localTranscriptionAcceleration ?? "auto",
            job.id,
            prompt,
          );
      segments.push(
        ...result.segments.map((segment) => ({
          ...segment,
          start: segment.start + offset + partOffset,
          end: segment.end + offset + partOffset,
        })),
      );
      partOffset +=
        (await duration(upload)) ||
        Math.max(0, ...result.segments.map((segment) => segment.end));
    }
    // Drop large API blobs before the next recording is fetched from IndexedDB.
    uploads = [];
    const partDuration =
      parts[index].duration || partOffset || (await duration(asset.blob));
    updatedParts[index] = { ...parts[index], duration: partDuration };
    offset += partDuration;
    // Give Chromium and the native process bridge a turn to release media
    // decoders and buffers before the next lecture/part starts.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
  const latest = useAppStore.getState();
  latest.updateLecture(job.lectureId, {
    audioParts: updatedParts,
    audioDuration: offset,
  });
  latest.setSegments(job.lectureId, segments);
  return `${segments.length} segment skapades.`;
}

function parentChain(nodes: LibraryNode[], id: string) {
  const result: LibraryNode[] = [];
  let current = nodes.find((node) => node.id === id);
  while (current) {
    result.unshift(current);
    current = current.parentId
      ? nodes.find((node) => node.id === current?.parentId)
      : undefined;
  }
  return result;
}

function courseId(nodes: LibraryNode[], lectureId: string) {
  return parentChain(nodes, lectureId).find((node) => node.type === "course")
    ?.id;
}

async function generate(job: BatchJob) {
  if (cancelled.has(job.id)) throw new Error("BATCH_CANCELLED");
  const state = useAppStore.getState();
  if (state.settings.aiMode !== "api") {
    patchJob(job.id, {
      status: "waiting",
      detail: "Öppna föreläsningen och slutför copy/paste-flödet.",
    });
    return "WAITING";
  }
  const apiKey = await readCredential(`ai:${state.settings.aiProvider}`);
  if (!apiKey) throw new Error("API-nyckeln för kortgenerering saknas.");
  const node = state.nodes.find((item) => item.id === job.lectureId);
  const lecture = state.lectures[job.lectureId];
  if (!node || !lecture) throw new Error("Föreläsningen kunde inte hittas.");
  const chain = parentChain(state.nodes, job.lectureId);
  const contextFiles = await db.assets
    .where("nodeId")
    .anyOf(chain.map((item) => item.id))
    .toArray();
  const context = [
    state.settings.userContext,
    ...chain.map((item) => item.context),
    ...contextFiles.map((file) => file.extractedText ?? ""),
  ]
    .filter((text) => text.trim())
    .join("\n\n");
  const lectureSegments = state.segments.filter(
    (segment) => segment.lectureId === job.lectureId,
  );
  const existing = state.cards.filter(
    (card) =>
      courseId(state.nodes, card.lectureId) ===
      courseId(state.nodes, job.lectureId),
  );
  const chunks = planGenerationChunks(lectureSegments);
  const known = new Set(
    existing.map((card) =>
      `${card.front}\0${card.back}`.toLocaleLowerCase("sv"),
    ),
  );
  const generated = [] as ReturnType<typeof parseCardResponse>;
  for (const chunk of chunks) {
    if (cancelled.has(job.id)) throw new Error("BATCH_CANCELLED");
    patchJob(job.id, {
      detail:
        chunks.length > 1
          ? `Skapar kort · del ${chunk.index + 1} av ${chunk.total}…`
          : "Skapar kort…",
    });
    const prompt = createCardPrompt({
      lectureId: job.lectureId,
      title: node.title,
      context,
      sourceStatus:
        chunks.length > 1
          ? `Använd transkriptets del ${chunk.index + 1} av ${chunk.total}, samt slides, anteckningar och context självständigt.`
          : "Använd transkript, slides, anteckningar och context självständigt.",
      notes: lecture.notes,
      transcript: chunk.transcript,
      markers: state.markers.filter(
        (marker) => marker.lectureId === job.lectureId,
      ),
      slideText: lecture.slideText ?? "",
      density: "balanced",
      count: chunkCardCeiling(36, chunk),
      types: ["basic", "concept"] satisfies CardType[],
      preferences: [
        "Undvik triviala kort",
        "Ett koncept per kort",
        "Prioritera examinationsrelevant förståelse",
      ],
      cardStyle: Object.assign({}, ...chain.map((item) => item.settings))
        .cardStyle,
      existingCards: [...existing, ...generated].map(({ front, back }) => ({
        front,
        back,
      })),
    });
    const raw = await generateCardsWithApi(prompt, state.settings, apiKey);
    const parsed = parseCardResponse(raw, job.lectureId).slice(
      0,
      chunkCardCeiling(36, chunk),
    );
    generated.push(
      ...parsed.filter((card) => {
        const key = `${card.front}\0${card.back}`.toLocaleLowerCase("sv");
        if (known.has(key)) return false;
        known.add(key);
        return true;
      }),
    );
  }
  useAppStore.getState().addCards(generated);
  return `${generated.length} nya kort skapades för granskning.`;
}

async function approve(job: BatchJob) {
  if (cancelled.has(job.id)) throw new Error("BATCH_CANCELLED");
  const state = useAppStore.getState();
  const cards = state.cards.filter(
    (card) => card.lectureId === job.lectureId && card.status === "generated",
  );
  cards.forEach((card) => state.updateCard(card.id, { status: "approved" }));
  return `${cards.length} kort godkändes.`;
}

async function sync(job: BatchJob) {
  if (cancelled.has(job.id)) throw new Error("BATCH_CANCELLED");
  let state = useAppStore.getState();
  await testAnki(state.settings.ankiUrl);
  const deletions = state.pendingAnkiDeletions.filter(
    (item) => item.lectureId === job.lectureId,
  );
  const failures: string[] = [];
  for (const deletion of deletions) {
    if (cancelled.has(job.id)) throw new Error("BATCH_CANCELLED");
    try {
      await deleteNote(state.settings.ankiUrl, deletion.ankiId);
      useAppStore.getState().resolveAnkiNoteDeletion(deletion.ankiId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useAppStore
        .getState()
        .markAnkiNoteDeletionError(deletion.ankiId, message);
      failures.push(message);
    }
  }
  state = useAppStore.getState();
  const deck = await ensureDeck(
    state.settings.ankiUrl,
    lectureDeckName(state.nodes, job.lectureId, state.settings.defaultDeck),
  );
  const cards = state.cards.filter(
    (card) =>
      card.lectureId === job.lectureId &&
      (card.status === "approved" || card.status === "synced") &&
      (needsAnkiSync(card, deck) || Boolean(card.ankiSyncError)),
  );
  for (const card of cards) {
    if (cancelled.has(job.id)) throw new Error("BATCH_CANCELLED");
    try {
      const tags = [...new Set(withoutStructuralTags(card.tags))];
      const ankiId = await syncCard(state.settings.ankiUrl, deck, {
        ...card,
        tags,
      });
      useAppStore.getState().updateCard(card.id, {
        status: "synced",
        ankiId,
        ankiDeck: deck,
        tags,
        ankiSyncError: undefined,
        ankiSyncErrorAt: undefined,
        ankiSyncedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useAppStore.getState().updateCard(card.id, {
        ankiSyncError: message,
        ankiSyncErrorAt: new Date().toISOString(),
      });
      failures.push(message);
    }
  }
  if (failures.length)
    throw new Error(
      `${failures.length} Anki-ändringar misslyckades: ${failures[0]}`,
    );
  useAppStore.getState().updateLecture(job.lectureId, {
    ankiLastSyncedAt: new Date().toISOString(),
  });
  return `${cards.length} kort synkades${deletions.length ? ` och ${deletions.length} raderades` : ""}.`;
}

async function execute(job: BatchJob) {
  if (job.action === "transcribe")
    return runExclusiveTranscription(job.id, () => transcribe(job));
  if (job.action === "generate") return generate(job);
  if (job.action === "approve") return approve(job);
  return sync(job);
}

async function drain() {
  if (running) return;
  running = true;
  try {
    while (jobs.some((job) => job.status === "queued")) {
      const job = jobs.find((item) => item.status === "queued");
      if (!job) break;
      patchJob(job.id, { status: "running", detail: "Startar…" });
      try {
        const detail = await execute(job);
        if (detail === "WAITING") break;
        patchJob(job.id, { status: "complete", detail });
      } catch (error) {
        recordDiagnostic("batch-transcription", error);
        const wasCancelled =
          cancelled.has(job.id) || String(error).includes("BATCH_CANCELLED");
        patchJob(job.id, {
          status: wasCancelled ? "cancelled" : "error",
          detail: wasCancelled
            ? "Avbruten."
            : error instanceof Error
              ? error.message
              : String(error),
        });
      } finally {
        cancelled.delete(job.id);
      }
    }
  } finally {
    running = false;
  }
}

export function enqueueBatch(
  action: BatchAction,
  lectures: Array<{ id: string; title: string }>,
  overwrite = false,
) {
  load();
  const now = new Date().toISOString();
  const created = lectures.map((lecture) => ({
    id: `batch:${uid()}`,
    action,
    lectureId: lecture.id,
    lectureTitle: lecture.title,
    status: "queued" as const,
    detail: "Väntar i kö…",
    createdAt: now,
    updatedAt: now,
    overwrite,
  }));
  jobs = [...jobs, ...created];
  publish();
  void drain();
  return created;
}

export function retryBatchJob(id: string) {
  patchJob(id, { status: "queued", detail: "Väntar i kö…" });
  void drain();
}

export function completeWaitingBatchJob(id: string) {
  patchJob(id, {
    status: "complete",
    detail: "Copy/paste-flödet markerades som klart.",
  });
  void drain();
}

export async function cancelBatchJob(id: string) {
  cancelled.add(id);
  const job = jobs.find((item) => item.id === id);
  if (job?.action === "transcribe")
    await cancelLocalTranscription(id).catch(() => undefined);
  if (job?.status === "queued" || job?.status === "waiting") {
    patchJob(id, { status: "cancelled", detail: "Avbruten." });
    void drain();
  }
}

export function clearFinishedBatchJobs() {
  load();
  jobs = jobs.filter(
    (job) =>
      job.status === "queued" ||
      job.status === "running" ||
      job.status === "waiting",
  );
  publish();
}

/** Resumes safely persisted queued work when the batch view is opened again. */
export function resumeBatchQueue() {
  load();
  void drain();
}
