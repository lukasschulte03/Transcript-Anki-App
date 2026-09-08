import type {
  Flashcard,
  LectureData,
  LibraryNode,
  VisualCandidate,
} from "../core/types";
import { db } from "../core/database";

const stopWords = new Set([
  "och", "att", "det", "som", "med", "för", "den", "detta", "från",
  "slide", "bild", "eller", "vid", "till", "på", "av", "en", "ett",
]);

const words = (value: string) =>
  value
    .toLocaleLowerCase("sv")
    .match(/[\p{L}\p{N}]{3,}/gu)
    ?.filter((word) => !stopWords.has(word)) ?? [];

const contentFingerprint = (value: string) => {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

export async function visualSourceHash(blob: Blob) {
  const bytes = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(bytes)]
    .slice(0, 12)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

/** Creates compact, local descriptions. It intentionally makes no medical claim from pixels. */
export async function buildVisualIndex(blob: Blob, pages: string[]) {
  const sourceHash = await visualSourceHash(blob);
  const candidates: VisualCandidate[] = pages.map((page, index) => {
    const clean = page.replace(/\s+/g, " ").trim();
    return {
      id: `visual-${sourceHash}-${index + 1}`,
      slidePage: index + 1,
      description: clean
        ? `Slide ${index + 1}: ${clean.slice(0, 340)}`
        : `Slide ${index + 1}: visuell slide utan läsbar text.`,
      keywords: [...new Set(words(clean))].slice(0, 24),
      sourceHash,
      contentHash: contentFingerprint(clean || `visual-slide-${index + 1}`),
    };
  });
  return { sourceHash, candidates };
}

/** Builds candidates for raster images extracted locally from a PPTX archive. */
export async function buildPptxVisualIndex(
  presentation: Blob,
  images: Array<{ assetId: string; name: string; blob: Blob }>,
) {
  const sourceHash = await visualSourceHash(presentation);
  const fingerprints = await Promise.all(
    images.map((image) => visualSourceHash(image.blob)),
  );
  const candidates: VisualCandidate[] = images.map((image, index) => ({
    id: `visual-${sourceHash}-pptx-${index + 1}`,
    slidePage: index + 1,
    description: `PPTX-bild ${index + 1}: ${image.name}`,
    keywords: [...new Set(words(image.name))].slice(0, 24),
    sourceHash,
    contentHash: fingerprints[index],
    assetId: image.assetId,
  }));
  return { sourceHash, candidates };
}

/** Local lexical retrieval keeps visual metadata out of the general AI prompt. */
export function selectVisualCandidates(
  candidates: VisualCandidate[],
  query: string,
  limit = 60,
) {
  // A modest module library is cheap enough to expose in full. This avoids
  // missing a useful diagram merely because the transcript uses different
  // wording than the slide.
  if (candidates.length <= limit) return candidates;
  const queryWords = new Set(words(query));
  if (!queryWords.size) return candidates.slice(0, limit);
  const matches = candidates
    .map((candidate) => ({
      candidate,
      score: candidate.keywords.filter((keyword) => queryWords.has(keyword)).length,
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.candidate.slidePage - right.candidate.slidePage)
    .slice(0, limit)
    .map(({ candidate }) => candidate);
  return matches.length ? matches : candidates.slice(0, Math.min(limit, 20));
}

export function visualPromptLines(candidates: VisualCandidate[]) {
  return candidates
    .map(
      (candidate) =>
        `${candidate.id} | ${candidate.description.replace(/\s+/g, " ").slice(0, 150)}`,
    )
    .join("\n");
}

export type ModuleVisualCandidate = VisualCandidate & {
  lectureId: string;
  lectureTitle: string;
  moduleId: string;
};

/**
 * A module library is derived from lecture-local indexes, so it stays local,
 * incremental and does not duplicate slide blobs. Exact visual duplicates are
 * represented once while preserving the first stable source.
 */
export function moduleVisualCandidates(
  nodes: LibraryNode[],
  lectures: Record<string, LectureData>,
  moduleId: string,
  options: { includeHidden?: boolean } = {},
) {
  const descendants = new Set<string>([moduleId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.parentId && descendants.has(node.parentId) && !descendants.has(node.id)) {
        descendants.add(node.id);
        changed = true;
      }
    }
  }
  const candidates = nodes
    .filter((node) => node.type === "lecture" && descendants.has(node.id))
    .flatMap((node) => {
      const lecture = lectures[node.id];
      const hidden = new Set(lecture?.hiddenVisualIds ?? []);
      return (lecture?.visualIndex ?? [])
        .filter((candidate) => options.includeHidden || !hidden.has(candidate.id))
        .map((candidate) => ({
          ...candidate,
          description: `${node.title} · ${candidate.description}`,
          lectureId: node.id,
          lectureTitle: node.title,
          moduleId,
        }));
    });
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.contentHash ?? `${candidate.sourceHash}:${candidate.slidePage}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

let pdfRuntime: Promise<typeof import("pdfjs-dist")> | undefined;
async function loadPdfRuntime() {
  pdfRuntime ??= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]).then(([pdf, worker]) => {
    pdf.GlobalWorkerOptions.workerSrc = worker.default;
    return pdf;
  });
  return pdfRuntime;
}

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

async function renderVisualPng(
  lecture: LectureData,
  candidate: VisualCandidate,
  scale: number,
) {
  const sourceAssetId = candidate.assetId ?? lecture.slideAssetId!;
  const asset = await db.assets.get(sourceAssetId);
  if (asset?.mimeType.startsWith("image/")) return asset.blob;
  if (
    !asset ||
    (!/pdf/i.test(asset.mimeType) && !asset.name.toLowerCase().endsWith(".pdf"))
  )
    return undefined;
  const { getDocument } = await loadPdfRuntime();
  const task = getDocument({ data: new Uint8Array(await asset.blob.arrayBuffer()) });
  try {
    const pdfDocument = await task.promise;
    const page = await pdfDocument.getPage(candidate.slidePage);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  } finally {
    await task.destroy();
  }
}

/** Persisted local thumbnails keep module libraries responsive without syncing previews. */
export async function resolveVisualThumbnail(
  candidate: VisualCandidate,
  lecture: LectureData | undefined,
) {
  if (!lecture?.slideAssetId) return undefined;
  const sourceAssetId = candidate.assetId ?? lecture.slideAssetId;
  const id = `visual-thumbnail:${sourceAssetId}:${candidate.id}`;
  const cached = await db.visualThumbnails.get(id);
  if (cached) return cached.blob;
  try {
    const blob = await renderVisualPng(lecture, candidate, 0.35);
    if (!blob) return undefined;
    await db.visualThumbnails.put({
      id,
      assetId: sourceAssetId,
      visualId: candidate.id,
      blob,
      createdAt: new Date().toISOString(),
    });
    return blob;
  } catch {
    return undefined;
  }
}

const mediaCache = new Map<string, Promise<{ filename: string; data: string; caption: string } | undefined>>();

/** Renders only the slide page actually used by a card, immediately before Anki sync. */
export function resolveVisualMedia(
  card: Pick<Flashcard, "visualId">,
  lecture: LectureData | undefined,
) {
  if (!card.visualId || !lecture?.slideAssetId || !lecture.visualIndex?.length)
    return Promise.resolve(undefined);
  const candidate = lecture.visualIndex.find((item) => item.id === card.visualId);
  if (!candidate) return Promise.resolve(undefined);
  const key = `${candidate.assetId ?? lecture.slideAssetId}:${candidate.id}`;
  if (!mediaCache.has(key)) {
    mediaCache.set(key, (async () => {
      try {
        const image = await renderVisualPng(lecture, candidate, 1.35);
        if (!image) return undefined;
        return {
          filename: `lectio-${candidate.id}.png`,
          data: await blobToBase64(image),
          caption: `Bild från slide ${candidate.slidePage}`,
        };
      } catch {
        return undefined;
      }
    })());
  }
  return mediaCache.get(key)!;
}
