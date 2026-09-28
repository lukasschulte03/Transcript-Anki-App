import { resolveCardGenerationSettings, type LibraryNode } from "../core/types";
import { db } from "../core/database";
import { libraryRepository } from "../infrastructure/libraryRepository";
import { DATA_PROFILE } from "../runtimeProfile";
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
import { commitCardReplacement, planCardReplacement } from "./cardReplacement";
import { runExclusiveTranscription } from "./transcriptionQueue";
import { recordDiagnostic } from "./diagnostics";
import { analyzeVisualCrop } from "./apiVisualAnalysis";
import {
  getLocalVisionStatus,
  localNvidiaVisionProvider,
} from "./localVision";
import { runExclusiveVision } from "./visualDescriptionQueue";
import {
  buildStoredSlideVisualIndex,
  moduleVisualCandidates,
  resolveVisualDescriptionImage,
  resolveVisualMedia,
  selectVisualCandidates,
} from "./visualIndex";

export type BatchAction =
  | "transcribe"
  | "generate"
  | "approve"
  | "sync"
  | "extractImages"
  | "describeImages";
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
  current?: number;
  total?: number;
};

const storageKey =
  DATA_PROFILE === "main" || DATA_PROFILE === "stability"
    ? "lectio-batch-jobs-v1"
    : `lectio-batch-jobs-v1:${DATA_PROFILE}`;
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
  const lecture = libraryRepository.getState().lectures[lectureId];
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
  const state = libraryRepository.getState();
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
      current: index,
      total: parts.length,
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
  const latest = libraryRepository.getState();
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
  const state = libraryRepository.getState();
  const generation = resolveCardGenerationSettings(
    state.settings.cardGeneration,
  );
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
  const moduleId = chain.find((item) => item.type === "module")?.id;
  const visuals = moduleId
    ? moduleVisualCandidates(state.nodes, state.lectures, moduleId)
    : (lecture.visualIndex ?? []).map((candidate) => ({
        ...candidate,
        lectureId: job.lectureId,
        lectureTitle: node.title,
        moduleId: "",
      }));
  const visualSources = new Map(
    visuals.map((candidate) => [candidate.id, candidate.lectureId]),
  );
  const rankedVisuals = [...visuals].sort(
    (left, right) =>
      Number(right.lectureId === job.lectureId) -
        Number(left.lectureId === job.lectureId) ||
      left.slidePage - right.slidePage,
  );
  const contextFiles = await db.assets
    .where("nodeId")
    .anyOf(chain.map((item) => item.id))
    .toArray();
  const enabledContextNodeIds = new Set(
    chain
      .filter(
        (item) =>
          item.type !== "workspace" &&
          generation.contextLevels[
            item.type as keyof typeof generation.contextLevels
          ],
      )
      .map((item) => item.id),
  );
  const context = generation.sources.context
    ? [
        generation.contextLevels.global ? state.settings.userContext : "",
        ...chain
          .filter(
            (item) =>
              item.type !== "workspace" &&
              generation.contextLevels[
                item.type as keyof typeof generation.contextLevels
              ],
          )
          .map((item) => item.context),
        ...contextFiles
          .filter(
            (file) => !file.nodeId || enabledContextNodeIds.has(file.nodeId),
          )
          .map((file) => file.extractedText ?? ""),
      ]
        .filter((text) => text.trim())
        .join("\n\n")
    : "";
  const lectureSegments = state.segments.filter(
    (segment) => segment.lectureId === job.lectureId,
  );
  const existing = state.cards.filter(
    (card) =>
      courseId(state.nodes, card.lectureId) ===
      courseId(state.nodes, job.lectureId),
  );
  const replacement = planCardReplacement(
    existing,
    job.lectureId,
    Boolean(job.overwrite),
  );
  const chunks = planGenerationChunks(
    generation.sources.transcript ? lectureSegments : [],
  );
  const known = new Set(
    replacement.referenceCards.map((card) =>
      `${card.front}\0${card.back}`.toLocaleLowerCase("sv"),
    ),
  );
  const generated = [] as ReturnType<typeof parseCardResponse>;
  for (const chunk of chunks) {
    if (cancelled.has(job.id)) throw new Error("BATCH_CANCELLED");
    patchJob(job.id, {
      current: chunk.index,
      total: chunk.total,
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
      notes: generation.sources.notes ? lecture.notes : "",
      transcript: chunk.transcript,
      markers: generation.sources.markers
        ? state.markers.filter((marker) => marker.lectureId === job.lectureId)
        : [],
      slideText: generation.sources.slides ? (lecture.slideText ?? "") : "",
      visualCandidates: generation.sources.slides
        ? selectVisualCandidates(
            rankedVisuals,
            chunk.transcript.map((segment) => segment.text).join("\n"),
          )
        : [],
      density: generation.density,
      count: chunkCardCeiling(
        generation.density === "few"
          ? 18
          : generation.density === "many"
            ? 54
            : 36,
        chunk,
      ),
      types: generation.types,
      preferences: generation.preferences,
      cardStyle: Object.assign({}, ...chain.map((item) => item.settings))
        .cardStyle,
      existingCards: [...replacement.referenceCards, ...generated].map(
        ({ front, back }) => ({
          front,
          back,
        }),
      ),
    });
    const raw = await generateCardsWithApi(prompt, state.settings, apiKey);
    const visualIds = new Set(visualSources.keys());
    const parsed = parseCardResponse(raw, job.lectureId)
      .slice(
        0,
        chunkCardCeiling(
          generation.density === "few"
            ? 18
            : generation.density === "many"
              ? 54
              : 36,
          chunk,
        ),
      )
      .map((card) =>
        card.visualId && !visualIds.has(card.visualId)
          ? { ...card, visualId: undefined }
          : card.visualId
            ? { ...card, visualLectureId: visualSources.get(card.visualId) }
            : card,
      );
    generated.push(
      ...parsed.filter((card) => {
        const key = `${card.front}\0${card.back}`.toLocaleLowerCase("sv");
        if (known.has(key)) return false;
        known.add(key);
        return true;
      }),
    );
    patchJob(job.id, {
      current: chunk.index + 1,
      total: chunk.total,
      detail: `Del ${chunk.index + 1} av ${chunk.total} klar.`,
    });
  }
  if (!generated.length && replacement.replacedCardIds.length) {
    return "Inga nya kort skapades; de befintliga korten behölls.";
  }
  commitCardReplacement(replacement, generated, libraryRepository.getState());
  return `${generated.length} nya kort skapades för granskning.`;
}

async function approve(job: BatchJob) {
  if (cancelled.has(job.id)) throw new Error("BATCH_CANCELLED");
  const state = libraryRepository.getState();
  const cards = state.cards.filter(
    (card) => card.lectureId === job.lectureId && card.status === "generated",
  );
  cards.forEach((card, index) => {
    state.updateCard(card.id, { status: "approved" });
    patchJob(job.id, {
      current: index + 1,
      total: cards.length,
      detail: `Godkänner kort ${index + 1} av ${cards.length}…`,
    });
  });
  return `${cards.length} kort godkändes.`;
}

async function sync(job: BatchJob) {
  if (cancelled.has(job.id)) throw new Error("BATCH_CANCELLED");
  let state = libraryRepository.getState();
  await testAnki(state.settings.ankiUrl);
  const deletions = state.pendingAnkiDeletions.filter(
    (item) => item.lectureId === job.lectureId,
  );
  const failures: string[] = [];
  let completed = 0;
  for (const deletion of deletions) {
    if (cancelled.has(job.id)) throw new Error("BATCH_CANCELLED");
    try {
      await deleteNote(state.settings.ankiUrl, deletion.ankiId);
      libraryRepository.getState().resolveAnkiNoteDeletion(deletion.ankiId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      libraryRepository
        .getState()
        .markAnkiNoteDeletionError(deletion.ankiId, message);
      failures.push(message);
    }
    completed += 1;
    patchJob(job.id, {
      current: completed,
      total: deletions.length,
      detail: `Tar bort gammalt kort ${completed} av ${deletions.length}…`,
    });
  }
  state = libraryRepository.getState();
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
  const total = completed + cards.length;
  for (const card of cards) {
    if (cancelled.has(job.id)) throw new Error("BATCH_CANCELLED");
    try {
      const tags = [...new Set(withoutStructuralTags(card.tags))];
      const media = await resolveVisualMedia(
        card,
        state.lectures[card.visualLectureId ?? card.lectureId],
      );
      const ankiId = await syncCard(
        state.settings.ankiUrl,
        deck,
        { ...card, tags },
        media,
      );
      libraryRepository.getState().updateCard(card.id, {
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
      libraryRepository.getState().updateCard(card.id, {
        ankiSyncError: message,
        ankiSyncErrorAt: new Date().toISOString(),
      });
      failures.push(message);
    }
    completed += 1;
    patchJob(job.id, {
      current: completed,
      total,
      detail: `Synkar kort ${completed} av ${total}…`,
    });
  }
  if (failures.length)
    throw new Error(
      `${failures.length} Anki-ändringar misslyckades: ${failures[0]}`,
    );
  libraryRepository.getState().updateLecture(job.lectureId, {
    ankiLastSyncedAt: new Date().toISOString(),
  });
  return `${cards.length} kort synkades${deletions.length ? ` och ${deletions.length} raderades` : ""}.`;
}

async function extractImages(job: BatchJob) {
  if (cancelled.has(job.id)) throw new Error("BATCH_CANCELLED");
  const initial = libraryRepository.getState().lectures[job.lectureId];
  if (!initial?.slideAssetId) throw new Error("Lägg till slides först.");
  const sourceAssetId = initial.slideAssetId;
  const indexed = await runQueuedVisionJob(job, (signal) =>
    buildStoredSlideVisualIndex(initial, (current, total, detail) => {
      if (cancelled.has(job.id) || signal.aborted)
        throw new Error("BATCH_CANCELLED");
      patchJob(job.id, { current, total, detail });
    }),
  );
  if (cancelled.has(job.id)) throw new Error("BATCH_CANCELLED");
  if (!indexed) throw new Error("Slides kunde inte analyseras.");

  const latest = libraryRepository.getState().lectures[job.lectureId];
  if (!latest || latest.slideAssetId !== sourceAssetId)
    throw new Error("Slides ändrades under extraheringen. Försök igen.");

  const deleted = new Set(latest.deletedVisualIds ?? []);
  const existingVision = new Map(
    (latest.visualIndex ?? []).map((item) => [item.id, item.localVision]),
  );
  const existingAnalysis = new Map(
    (latest.visualIndex ?? []).map((item) => [item.id, item.visualAnalysis]),
  );
  const candidates = indexed.candidates
    .filter((item) => !deleted.has(item.id))
    .map((item) => ({
      ...item,
      localVision: existingVision.get(item.id),
      visualAnalysis: existingAnalysis.get(item.id),
    }));
  if (candidates.length || !latest.visualIndex?.length) {
    libraryRepository.getState().updateLecture(job.lectureId, {
      visualIndex: candidates,
      visualIndexHash: indexed.sourceHash,
      visualIndexVersion: 2,
      visualIndexUpdatedAt: new Date().toISOString(),
    });
  }
  return `${candidates.length} bildutklipp hittades.`;
}

function runQueuedVisionJob<T>(
  job: BatchJob,
  run: (signal: AbortSignal) => Promise<T>,
) {
  return new Promise<T>((resolve, reject) => {
    runExclusiveVision(job.id, async (signal) => {
      try {
        if (cancelled.has(job.id)) throw new Error("BATCH_CANCELLED");
        resolve(await run(signal));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function describeImages(job: BatchJob) {
  const state = libraryRepository.getState();
  const lecture = state.lectures[job.lectureId];
  const candidates = lecture?.visualIndex ?? [];
  if (!lecture || !candidates.length)
    throw new Error("Extrahera bilder från slides innan du beskriver dem.");
  const settings = state.settings;
  const useApi = settings.visualAnalysisProvider === "api";
  let apiKey = "";
  if (useApi) {
    const savedKey = await readCredential("visual:openai");
    if (!savedKey)
      throw new Error("Spara en OpenAI-nyckel under Inställningar → Bildanalys först.");
    apiKey = savedKey;
  } else {
    const status = await getLocalVisionStatus();
    if (!status.ready)
      throw new Error(
        status.nvidiaDetected && !status.nvidiaRuntimeReady
          ? "Nvidia hittades, men CUDA-stödet i Lectios bildmotor är inte redo. Öppna Inställningar och välj Reparera Nvidia-stöd."
          : status.nvidiaDetected
            ? "Den lokala bildmotorn är inte redo. Kontrollera den under Inställningar."
          : "Lokala bildbeskrivningar kräver en Nvidia-GPU.",
      );
  }

  const model = settings.visualAnalysisModel;
  const pending = candidates.filter((candidate) =>
    job.overwrite
      ? true
      : useApi
        ? candidate.visualAnalysis?.provider !== "openai" ||
          candidate.visualAnalysis.model !== model ||
          candidate.visualAnalysis.sourceHash !== candidate.sourceHash
        : candidate.localVision?.sourceHash !==
          (candidate.contentHash ?? candidate.sourceHash),
  );
  if (!pending.length) return "Alla bilder har redan en aktuell AI-beskrivning.";
  patchJob(job.id, {
    current: 0,
    total: pending.length,
    detail: "Väntar på bildmotorn…",
  });

  const title =
    state.nodes.find((node) => node.id === job.lectureId)?.title ??
    job.lectureTitle;
  let completed = 0;
  await runQueuedVisionJob(job, async (signal) => {
    for (const candidate of pending) {
      if (cancelled.has(job.id) || signal.aborted)
        throw new Error("BATCH_CANCELLED");
      const latestState = libraryRepository.getState();
      const currentLecture = latestState.lectures[job.lectureId];
      const currentCandidate = currentLecture?.visualIndex?.find(
        (item) => item.id === candidate.id,
      );
      if (!currentLecture || !currentCandidate) {
        completed += 1;
        continue;
      }
      patchJob(job.id, {
        current: completed,
        total: pending.length,
        detail: `Beskriver bild ${completed + 1} av ${pending.length}…`,
      });
      const image = await resolveVisualDescriptionImage(
        currentCandidate,
        currentLecture,
      );
      if (!image)
        throw new Error(
          `Bildutklippet från slide ${candidate.slidePage} kunde inte öppnas.`,
        );

      if (useApi) {
        const result = await analyzeVisualCrop(image, {
          apiKey,
          model,
          localOcrText: currentCandidate.cropText,
        });
        if (cancelled.has(job.id) || signal.aborted)
          throw new Error("BATCH_CANCELLED");
        const latest = libraryRepository.getState().lectures[job.lectureId];
        if (latest?.visualIndex) {
          libraryRepository.getState().updateLecture(job.lectureId, {
            visualIndex: latest.visualIndex.map((item) =>
              item.id === candidate.id
                ? {
                    ...item,
                    visualAnalysis: {
                      ...result,
                      provider: "openai",
                      model,
                      generatedAt: new Date().toISOString(),
                      sourceHash: item.sourceHash,
                    },
                  }
                : item,
            ),
          });
        }
      } else {
        const chain = [] as string[];
        let node = latestState.nodes.find((item) => item.id === job.lectureId);
        const visited = new Set<string>();
        while (node && !visited.has(node.id)) {
          visited.add(node.id);
          if (node.context?.trim()) chain.unshift(node.context.trim());
          node = node.parentId
            ? latestState.nodes.find((item) => item.id === node?.parentId)
            : undefined;
        }
        const slideText =
          currentLecture.slidePages?.[
            Math.max(0, currentCandidate.slidePage - 1)
          ] ?? currentCandidate.description;
        const context = [
          `Föreläsning: ${title}`,
          `Slide ${currentCandidate.slidePage}: ${slideText}`,
          chain.length ? `Studiecontext: ${chain.join(" ")}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        const result = await localNvidiaVisionProvider.describe(
          image,
          signal,
          context,
        );
        const latest = libraryRepository.getState().lectures[job.lectureId];
        if (latest?.visualIndex) {
          libraryRepository.getState().updateLecture(job.lectureId, {
            visualIndex: latest.visualIndex.map((item) =>
              item.id === candidate.id
                ? {
                    ...item,
                    localVision: {
                      ...result,
                      model: "Lectio Nvidia Vision",
                      generatedAt: new Date().toISOString(),
                      sourceHash: item.contentHash ?? item.sourceHash,
                    },
                  }
                : item,
            ),
          });
        }
      }
      completed += 1;
      patchJob(job.id, {
        current: completed,
        total: pending.length,
        detail: `Bild ${completed} av ${pending.length} beskriven.`,
      });
    }
  });
  return `${completed} bilder fick AI-beskrivningar.`;
}

async function execute(job: BatchJob) {
  if (job.action === "transcribe")
    return runExclusiveTranscription(job.id, () => transcribe(job));
  if (job.action === "generate") return generate(job);
  if (job.action === "approve") return approve(job);
  if (job.action === "extractImages") return extractImages(job);
  if (job.action === "describeImages") return describeImages(job);
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
        recordDiagnostic(
          job.action === "extractImages" || job.action === "describeImages"
            ? "batch-vision"
            : "batch-transcription",
          error,
        );
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
  if (job?.action === "extractImages" || job?.action === "describeImages") {
    const { cancelActiveVision } = await import("./visualDescriptionQueue");
    cancelActiveVision(id);
  }
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
