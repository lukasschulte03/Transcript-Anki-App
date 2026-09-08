import type { Flashcard, LectureData, VisualCandidate } from "../core/types";
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
    };
  });
  return { sourceHash, candidates };
}

/** Local lexical retrieval keeps visual metadata out of the general AI prompt. */
export function selectVisualCandidates(
  candidates: VisualCandidate[],
  query: string,
  limit = 12,
) {
  const queryWords = new Set(words(query));
  if (!queryWords.size) return candidates.slice(0, Math.min(limit, 6));
  return candidates
    .map((candidate) => ({
      candidate,
      score: candidate.keywords.filter((keyword) => queryWords.has(keyword)).length,
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.candidate.slidePage - right.candidate.slidePage)
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

export function visualPromptLines(candidates: VisualCandidate[]) {
  return candidates
    .map((candidate) => `${candidate.id} | ${candidate.description}`)
    .join("\n");
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

const mediaCache = new Map<string, Promise<{ filename: string; data: string; caption: string } | undefined>>();

/** Renders only the slide page actually used by a card, immediately before Anki sync. */
export function resolveVisualMedia(card: Flashcard, lecture: LectureData | undefined) {
  if (!card.visualId || !lecture?.slideAssetId || !lecture.visualIndex?.length)
    return Promise.resolve(undefined);
  const candidate = lecture.visualIndex.find((item) => item.id === card.visualId);
  if (!candidate) return Promise.resolve(undefined);
  const key = `${lecture.slideAssetId}:${candidate.id}`;
  if (!mediaCache.has(key)) {
    mediaCache.set(key, (async () => {
      try {
        const asset = await db.assets.get(lecture.slideAssetId!);
        if (!asset || (!/pdf/i.test(asset.mimeType) && !asset.name.toLowerCase().endsWith(".pdf"))) return undefined;
        const { getDocument } = await loadPdfRuntime();
        const task = getDocument({ data: new Uint8Array(await asset.blob.arrayBuffer()) });
        try {
          const pdfDocument = await task.promise;
          const page = await pdfDocument.getPage(candidate.slidePage);
          const viewport = page.getViewport({ scale: 1.35 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (!context) return undefined;
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          const image = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
          if (!image) return undefined;
          return {
            filename: `lectio-${candidate.id}.png`,
            data: await blobToBase64(image),
            caption: `Bild från slide ${candidate.slidePage}`,
          };
        } finally {
          await task.destroy();
        }
      } catch {
        return undefined;
      }
    })());
  }
  return mediaCache.get(key)!;
}
