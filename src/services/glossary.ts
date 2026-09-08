import type { LibraryNode, TranscriptSegment } from "../core/types";

const ignored = new Set([
  "slide",
  "föreläsning",
  "patient",
  "detta",
  "med",
  "och",
  "eller",
  "som",
  "den",
  "att",
  "för",
]);

export function glossaryTerms(value: string) {
  return [
    ...new Set(
      value
        .split(/[\n,;]+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2),
    ),
  ];
}

export function formatGlossary(terms: string[]) {
  return [...new Set(terms.map((term) => term.trim()).filter(Boolean))].join(
    ", ",
  );
}

/** Slide text is already extracted locally. OCR is deliberately only a fallback in pdf.ts. */
export function suggestGlossaryFromSlides(slideText: string, limit = 60) {
  const candidates =
    slideText
      .replace(/Slide\s+\d+/gi, "")
      .match(/[A-ZÅÄÖ]{2,}|[A-Za-zÅÄÖåäö-]{5,}(?:\s+[A-Za-zÅÄÖåäö-]{4,})?/g) ??
    [];
  return [
    ...new Set(
      candidates
        .map((term) => term.trim())
        .filter((term) => !ignored.has(term.toLocaleLowerCase("sv"))),
    ),
  ].slice(0, limit);
}

export function inheritedGlossary(
  nodes: LibraryNode[],
  lectureId: string,
  globalGlossary: string,
) {
  const chain: LibraryNode[] = [];
  let node = nodes.find((item) => item.id === lectureId);
  while (node) {
    chain.unshift(node);
    node = node.parentId
      ? nodes.find((item) => item.id === node?.parentId)
      : undefined;
  }
  const sources = [
    ...(globalGlossary.trim()
      ? [{ source: "Global", terms: glossaryTerms(globalGlossary) }]
      : []),
    ...chain
      .map((item) => ({
        source: item.title,
        terms: glossaryTerms(item.settings.transcriptionGlossary ?? ""),
      }))
      .filter((item) => item.terms.length),
  ];
  return {
    sources,
    terms: [...new Set(sources.flatMap((item) => item.terms))],
  };
}

function distance(left: string, right: string) {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => index);
  for (let column = 1; column <= right.length; column++) {
    let diagonal = rows[0];
    rows[0] = column;
    for (let row = 1; row <= left.length; row++) {
      const previous = rows[row];
      rows[row] = Math.min(
        rows[row] + 1,
        rows[row - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      diagonal = previous;
    }
  }
  return rows[left.length];
}

export type TerminologySuggestion = {
  segmentId: string;
  original: string;
  suggested: string;
  term: string;
};

export interface TerminologyReviewProvider {
  id: "local" | "api";
  suggest(
    segments: TranscriptSegment[],
    terms: string[],
  ): Promise<TerminologySuggestion[]>;
}

/** Conservative local provider: only near-matches against the user's own lexicon; never numbers. */
export function suggestTerminologyCorrections(
  segments: TranscriptSegment[],
  terms: string[],
): TerminologySuggestion[] {
  const normalizedTerms = terms
    .filter((term) => /^[\p{L}-]+$/u.test(term))
    .map((term) => ({ term, key: term.toLocaleLowerCase("sv") }));
  return segments.flatMap((segment) => {
    let suggested = segment.text;
    const changed: string[] = [];
    for (const word of segment.text.match(/[\p{L}-]+/gu) ?? []) {
      const key = word.toLocaleLowerCase("sv");
      const match = normalizedTerms.find(
        ({ key: candidate }) =>
          candidate !== key &&
          key.length >= 5 &&
          Math.abs(candidate.length - key.length) <= 2 &&
          distance(key, candidate) <= 2,
      );
      if (match) {
        suggested = suggested.replace(word, match.term);
        changed.push(match.term);
      }
    }
    return changed.length
      ? [
          {
            segmentId: segment.id,
            original: segment.text,
            suggested,
            term: changed.join(", "),
          },
        ]
      : [];
  });
}

/** The local provider is the default: no transcript leaves the device. */
export const localTerminologyReviewProvider: TerminologyReviewProvider = {
  id: "local",
  async suggest(segments, terms) {
    return suggestTerminologyCorrections(segments, terms);
  },
};
