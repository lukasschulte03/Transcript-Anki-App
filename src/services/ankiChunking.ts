import type { TranscriptSegment } from "../core/types";

export type GenerationChunk = {
  index: number;
  total: number;
  transcript: TranscriptSegment[];
};

/**
 * Keeps semantic transcript segments intact. The deliberately conservative
 * limit leaves room for slides, notes and inherited context in every prompt.
 */
export function planGenerationChunks(
  segments: TranscriptSegment[],
  maximumTokens = 10_000,
): GenerationChunk[] {
  const ordered = [...segments].sort((left, right) => left.start - right.start);
  if (!ordered.length) return [{ index: 0, total: 1, transcript: [] }];
  const groups: TranscriptSegment[][] = [];
  let current: TranscriptSegment[] = [];
  let characters = 0;
  for (const segment of ordered) {
    const next = segment.text.length + 1;
    if (current.length && characters + next > maximumTokens * 4) {
      groups.push(current);
      current = [];
      characters = 0;
    }
    current.push(segment);
    characters += next;
  }
  if (current.length) groups.push(current);
  return groups.map((transcript, index) => ({ index, total: groups.length, transcript }));
}

export function chunkCardCeiling(totalCeiling: number, chunk: GenerationChunk) {
  return Math.max(4, Math.ceil(totalCeiling / chunk.total));
}
