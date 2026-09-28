import type {
  BatchAction,
  LibrarySnapshot,
} from "../../application/lectioClient";

export type SuperAction = BatchAction | "delete";

export function selectableSuperActionLectureIds(
  lectureIds: string[],
  eligibility: Map<string, string | null>,
  isComplete: (lectureId: string) => boolean,
  overwrite: boolean,
): string[] {
  return lectureIds.filter(
    (id) => eligibility.get(id) === null && (overwrite || !isComplete(id)),
  );
}

/** Builds per-lecture eligibility once per snapshot, avoiding repeated full-library scans while rendering the tree. */
export function buildSuperActionEligibility(
  action: SuperAction,
  library: LibrarySnapshot,
): Map<string, string | null> {
  const cardLectureIds = new Set(library.cards.map((card) => card.lectureId));
  const syncableLectureIds = new Set(
    library.cards
      .filter((card) => card.status === "approved" || card.status === "synced")
      .map((card) => card.lectureId),
  );
  const transcriptLectureIds = new Set(
    library.segments
      .filter((segment) => segment.text.trim())
      .map((segment) => segment.lectureId),
  );
  const markerLectureIds = new Set(
    library.markers
      .filter((marker) => marker.note.trim())
      .map((marker) => marker.lectureId),
  );

  return new Map(
    library.nodes
      .filter((node) => node.type === "lecture")
      .map(({ id }) => {
        const lecture = library.lectures[id];
        if (action === "transcribe") {
          const hasAudio = Boolean(
            lecture?.audioAssetId?.trim() ||
            lecture?.audioParts?.some((part) => part.assetId.trim()),
          );
          return [id, hasAudio ? null : "Saknar ljud"] as const;
        }

        if (action === "extractImages") {
          return [
            id,
            lecture?.slideAssetId?.trim() ? null : "Saknar slides",
          ] as const;
        }

        if (action === "describeImages") {
          return [
            id,
            lecture?.visualIndex?.length ? null : "Inga extraherade bilder",
          ] as const;
        }

        if (action === "generate") {
          const hasMaterial = Boolean(
            transcriptLectureIds.has(id) ||
            markerLectureIds.has(id) ||
            lecture?.notes.trim() ||
            lecture?.slideAssetId?.trim() ||
            lecture?.slideText?.trim() ||
            lecture?.slidePages?.some((page) => page.trim()) ||
            lecture?.visualIndex?.length,
          );
          return [
            id,
            hasMaterial
              ? null
              : "Saknar material (slides, transkript, anteckningar eller markeringar)",
          ] as const;
        }

        if (!cardLectureIds.has(id)) return [id, "Inga Anki-kort"] as const;
        if (action === "sync" && !syncableLectureIds.has(id)) {
          return [id, "Inga godkända kort att synka"] as const;
        }
        return [id, null] as const;
      }),
  );
}
