import type { TranscriptSegment } from "../core/types";

const terms = (value: string) =>
  new Set(
    value
      .toLocaleLowerCase("sv")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((term) => term.length > 2),
  );

export function suggestSlideMappings(
  pages: string[],
  transcript: TranscriptSegment[],
) {
  const pageTerms = pages.map(terms);
  const mappings: Record<string, { page: number; confidence: number }> = {};
  let earliestPage = 0;
  for (const segment of transcript) {
    const segmentTerms = terms(segment.text);
    if (!segmentTerms.size) continue;
    let bestPage = -1;
    let bestScore = 0;
    for (let page = earliestPage; page < pageTerms.length; page++) {
      const overlap = [...segmentTerms].filter((term) =>
        pageTerms[page].has(term),
      ).length;
      const score =
        overlap /
        Math.max(1, Math.min(segmentTerms.size, pageTerms[page].size));
      if (score > bestScore) {
        bestScore = score;
        bestPage = page;
      }
    }
    if (bestPage >= 0 && bestScore >= 0.12) {
      mappings[segment.id] = {
        page: bestPage + 1,
        confidence: Math.round(bestScore * 100),
      };
      earliestPage = bestPage;
    }
  }
  return mappings;
}
