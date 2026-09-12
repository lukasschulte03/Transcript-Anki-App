import type {
  Flashcard,
  LectureData,
  LibraryNode,
  VisualCandidate,
} from "../core/types";
import { db } from "../core/database";
import { extractPdfPages, formatSlideText } from "./pdf";
import { findSlideCrops } from "./slideCrop";

const stopWords = new Set([
  "och",
  "att",
  "det",
  "som",
  "med",
  "för",
  "den",
  "detta",
  "från",
  "slide",
  "bild",
  "eller",
  "vid",
  "till",
  "på",
  "av",
  "en",
  "ett",
]);

const words = (value: string) =>
  value
    .toLocaleLowerCase("sv")
    .match(/[\p{L}\p{N}]{3,}/gu)
    ?.filter((word) => !stopWords.has(word)) ?? [];

/** Keeps prompt material compact without cutting a sentence or table label in half. */
export const conciseVisualText = (value: string, limit = 220) => {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const sentence = clean.slice(0, limit + 1).match(/^.*?[.!?](?:\s|$)/)?.[0];
  if (sentence?.trim()) return sentence.trim();
  const boundary = clean.lastIndexOf(" ", limit);
  return `${clean.slice(0, boundary > 60 ? boundary : limit).trim()}…`;
};

export const visualCandidateDescription = (candidate: VisualCandidate) =>
  [candidate.cropText, candidate.localVision?.description]
    .filter(Boolean)
    .join(" · ") || candidate.description;

export const visualCandidateKeywords = (candidate: VisualCandidate) => [
  ...new Set([
    ...candidate.keywords,
    ...(candidate.localVision?.keywords ?? []),
  ]),
];

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

/**
 * Builds visual candidates only from PP-DocLayout layout crops. A PDF page is
 * never itself a candidate, which prevents full slides being sent to Anki.
 */
export async function buildPdfVisualIndex(
  presentation: Blob,
  pages: string[],
  onProgress?: (current: number, total: number, detail: string) => void,
) {
  const sourceHash = await visualSourceHash(presentation);
  const candidates: VisualCandidate[] = [];
  for (let index = 0; index < pages.length; index += 1) {
    const page = index + 1;
    onProgress?.(
      index,
      pages.length,
      index === 0
        ? "Startar lokal bildanalys… första gången kan ta någon minut."
        : `Analyserar slide ${page} av ${pages.length}…`,
    );
    const rendered = await renderPdfPage(presentation, page, 1.25);
    if (rendered) {
      const crops = await findSlideCrops(rendered);
      const clean = pages[index]?.replace(/\s+/g, " ").trim() ?? "";
      crops.forEach((crop, cropIndex) => {
        const cropText = crop.text?.replace(/\s+/g, " ").trim() ?? "";
        candidates.push({
          id: `visual-${sourceHash}-${page}-crop-${cropIndex + 1}`,
          slidePage: page,
          description: cropText
            ? `Slide ${page} · bildområde ${cropIndex + 1}: ${cropText.slice(0, 340)}`
            : clean
            ? `Slide ${page} · bildområde ${cropIndex + 1}: ${clean.slice(0, 340)}`
            : `Slide ${page} · bildområde ${cropIndex + 1}`,
          keywords: [...new Set(words(cropText || clean))].slice(0, 24),
          sourceHash,
          contentHash: contentFingerprint(
            `${cropText || clean}:${crop.x.toFixed(3)}:${crop.y.toFixed(3)}:${crop.width.toFixed(3)}:${crop.height.toFixed(3)}`,
          ),
          crop,
          cropText: cropText || undefined,
        });
      });
    }
    onProgress?.(
      page,
      pages.length,
      `Slide ${page} av ${pages.length} analyserad.`,
    );
  }
  return { sourceHash, candidates };
}

/**
 * Repairs slide indexes created before the visual-library feature existed.
 * The source asset remains local; this only derives compact page metadata.
 */
export async function buildStoredSlideVisualIndex(
  lecture: LectureData,
  onProgress?: (current: number, total: number, detail: string) => void,
) {
  if (!lecture.slideAssetId) return undefined;
  const asset = await db.assets.get(lecture.slideAssetId);
  if (!asset) return undefined;
  const isPdf =
    /pdf/i.test(asset.mimeType) || asset.name.toLowerCase().endsWith(".pdf");
  const isImage = asset.mimeType.startsWith("image/");
  if (!isPdf && !isImage) return undefined;
  const pages = isPdf
    ? lecture.slidePages?.length
      ? lecture.slidePages
      : await extractPdfPages(asset.blob)
    : [`Bild: ${asset.name}`];
  const visual = isPdf
    ? await buildPdfVisualIndex(asset.blob, pages, onProgress)
    : await buildVisualIndex(asset.blob, pages);
  return {
    ...visual,
    pages,
    slideText: formatSlideText(pages),
  };
}

/** Builds candidates for raster images extracted locally from a PPTX archive. */
export async function buildPptxVisualIndex(
  presentation: Blob,
  images: Array<{
    assetId: string;
    name: string;
    blob: Blob;
    slidePage?: number;
    nearbyText?: string;
  }>,
) {
  const sourceHash = await visualSourceHash(presentation);
  const fingerprints = await Promise.all(
    images.map((image) => visualSourceHash(image.blob)),
  );
  const candidates: VisualCandidate[] = images.map((image, index) => {
    const slidePage = image.slidePage ?? index + 1;
    const context = image.nearbyText?.replace(/\s+/g, " ").trim();
    return {
      id: `visual-${sourceHash}-pptx-${index + 1}`,
      slidePage,
      description: context
        ? `Slide ${slidePage} · PPTX-bild: ${context.slice(0, 340)}`
        : `Slide ${slidePage} · PPTX-bild: ${image.name}`,
      keywords: [...new Set(words(`${image.name} ${context ?? ""}`))].slice(
        0,
        24,
      ),
      sourceHash,
      contentHash: fingerprints[index],
      assetId: image.assetId,
    };
  });
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
      score: visualCandidateKeywords(candidate).filter((keyword) =>
        queryWords.has(keyword),
      ).length,
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.candidate.slidePage - right.candidate.slidePage,
    )
    .slice(0, limit)
    .map(({ candidate }) => candidate);
  return matches.length ? matches : candidates.slice(0, Math.min(limit, 20));
}

export function visualPromptLines(candidates: VisualCandidate[]) {
  return candidates
    .map(
      (candidate) =>
        `${candidate.id} | ${conciseVisualText(visualCandidateDescription(candidate), 180)}`,
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
      if (
        node.parentId &&
        descendants.has(node.parentId) &&
        !descendants.has(node.id)
      ) {
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
      const deleted = new Set(lecture?.deletedVisualIds ?? []);
      return (lecture?.visualIndex ?? [])
        .filter(
          (candidate) =>
            !deleted.has(candidate.id) &&
            (options.includeHidden || !hidden.has(candidate.id)),
        )
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
    const key =
      candidate.contentHash ?? `${candidate.sourceHash}:${candidate.slidePage}`;
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

async function cropRenderedSlide(blob: Blob, crop: VisualCandidate["crop"]) {
  if (!crop) return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  const sourceX = Math.max(0, Math.floor(crop.x * bitmap.width));
  const sourceY = Math.max(0, Math.floor(crop.y * bitmap.height));
  const sourceWidth = Math.max(1, Math.floor(crop.width * bitmap.width));
  const sourceHeight = Math.max(1, Math.floor(crop.height * bitmap.height));
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.drawImage(
    bitmap,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );
  bitmap.close();
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
}

async function renderPdfPage(
  presentation: Blob,
  pageNumber: number,
  scale: number,
) {
  const { getDocument } = await loadPdfRuntime();
  const task = getDocument({
    data: new Uint8Array(await presentation.arrayBuffer()),
  });
  try {
    const pdfDocument = await task.promise;
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
  } finally {
    await task.destroy();
  }
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
  const rendered = await renderPdfPage(asset.blob, candidate.slidePage, scale);
  return rendered ? cropRenderedSlide(rendered, candidate.crop) : undefined;
}

/** Returns a moderate local rendering suitable for a local vision runtime. */
export async function resolveVisualDescriptionImage(
  candidate: VisualCandidate,
  lecture: LectureData | undefined,
) {
  if (!lecture) return undefined;
  return renderVisualPng(lecture, candidate, 0.9);
}

/** Persisted local thumbnails keep module libraries responsive without syncing previews. */
export async function resolveVisualThumbnail(
  candidate: VisualCandidate,
  lecture: LectureData | undefined,
) {
  if (!lecture?.slideAssetId) return undefined;
  const sourceAssetId = candidate.assetId ?? lecture.slideAssetId;
  // Previews are rendered only for the selected visual and retained locally.
  // Render at the PDF's native 1× scale so the inspector never magnifies a
  // deliberately downsampled image.
  const id = `visual-thumbnail:v3:${sourceAssetId}:${candidate.id}`;
  const cached = await db.visualThumbnails.get(id);
  if (cached) return cached.blob;
  try {
    const blob = await renderVisualPng(lecture, candidate, 1);
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

const mediaCache = new Map<
  string,
  Promise<{ filename: string; data: string; caption: string } | undefined>
>();

/** Renders only the slide page actually used by a card, immediately before Anki sync. */
export function resolveVisualMedia(
  card: Pick<Flashcard, "visualId">,
  lecture: LectureData | undefined,
) {
  if (!card.visualId || !lecture?.slideAssetId || !lecture.visualIndex?.length)
    return Promise.resolve(undefined);
  const candidate = lecture.visualIndex.find(
    (item) => item.id === card.visualId,
  );
  if (!candidate) return Promise.resolve(undefined);
  const key = `${candidate.assetId ?? lecture.slideAssetId}:${candidate.id}`;
  if (!mediaCache.has(key)) {
    mediaCache.set(
      key,
      (async () => {
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
      })(),
    );
  }
  return mediaCache.get(key)!;
}
