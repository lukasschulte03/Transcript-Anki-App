import type {
  AppSettings,
  Flashcard,
  LectureData,
  LibraryNode,
  Marker,
  TranscriptSegment,
} from "../core/types";

export type PendingAnkiDeletion = {
  ankiId: number;
  lectureId?: string;
  error?: string;
  updatedAt?: string;
};

export type LibrarySyncSnapshot = {
  nodes: LibraryNode[];
  lectures: Record<string, LectureData>;
  segments: TranscriptSegment[];
  markers: Marker[];
  cards: Flashcard[];
  pendingAnkiDeletions: PendingAnkiDeletion[];
  settings: AppSettings;
};

export type MergeConflict = {
  collection: string;
  id: string;
  field: string;
};
export type MergeResolution = "local" | "remote";

const equal = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function mergeValue(
  base: unknown,
  local: unknown,
  remote: unknown,
  conflict: (field: string) => void,
  resolution?: MergeResolution,
  path = "",
): unknown {
  if (equal(local, remote)) return local;
  if (equal(local, base)) return remote;
  if (equal(remote, base)) return local;
  if (isRecord(local) && isRecord(remote) && (!base || isRecord(base))) {
    const result: Record<string, unknown> = {};
    const baseRecord = isRecord(base) ? base : {};
    for (const key of new Set([
      ...Object.keys(baseRecord),
      ...Object.keys(local),
      ...Object.keys(remote),
    ])) {
      const value = mergeValue(
        baseRecord[key],
        local[key],
        remote[key],
        conflict,
        resolution,
        path ? `${path}.${key}` : key,
      );
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  conflict(path || "värde");
  return resolution === "remote" ? remote : local;
}

function mergeCollection<T extends { id: string }>(
  collection: string,
  base: T[],
  local: T[],
  remote: T[],
  conflicts: MergeConflict[],
  resolution?: MergeResolution,
) {
  const byId = (items: T[]) => new Map(items.map((item) => [item.id, item]));
  const baseById = byId(base);
  const localById = byId(local);
  const remoteById = byId(remote);
  const merged: T[] = [];
  for (const id of new Set([
    ...baseById.keys(),
    ...localById.keys(),
    ...remoteById.keys(),
  ])) {
    const before = baseById.get(id);
    const here = localById.get(id);
    const there = remoteById.get(id);
    if (!before) {
      if (!here) {
        if (there) merged.push(there);
        continue;
      }
      if (!there) {
        merged.push(here);
        continue;
      }
      merged.push(
        mergeValue(
          undefined,
          here,
          there,
          (field) =>
            conflicts.push({
              collection,
              id,
              field: field.replace(/^value\./, ""),
            }),
          resolution,
        ) as T,
      );
      continue;
    }
    if (!here || !there) {
      const changed = here ? !equal(here, before) : !equal(there, before);
      if (changed) {
        conflicts.push({ collection, id, field: "radering" });
        const chosen =
          resolution === "remote"
            ? there
            : resolution === "local"
              ? here
              : undefined;
        if (chosen) merged.push(chosen);
      }
      continue;
    }
    merged.push(
      mergeValue(
        before,
        here,
        there,
        (field) =>
          conflicts.push({
            collection,
            id,
            field: field.replace(/^value\./, ""),
          }),
        resolution,
      ) as T,
    );
  }
  return merged;
}

function asItems<T>(record: Record<string, T>) {
  return Object.entries(record).map(([id, value]) => ({ id, value }));
}

export function mergeLibrarySnapshots(
  base: LibrarySyncSnapshot,
  local: LibrarySyncSnapshot,
  remote: LibrarySyncSnapshot,
  resolution?: MergeResolution,
) {
  const conflicts: MergeConflict[] = [];
  const lectureItems = mergeCollection(
    "föreläsningar",
    asItems(base.lectures),
    asItems(local.lectures),
    asItems(remote.lectures),
    conflicts,
    resolution,
  );
  return {
    conflicts,
    snapshot: {
      nodes: mergeCollection(
        "bibliotek",
        base.nodes,
        local.nodes,
        remote.nodes,
        conflicts,
        resolution,
      ),
      lectures: Object.fromEntries(
        lectureItems.map((item) => [item.id, item.value]),
      ) as Record<string, LectureData>,
      segments: mergeCollection(
        "transkript",
        base.segments,
        local.segments,
        remote.segments,
        conflicts,
        resolution,
      ),
      markers: mergeCollection(
        "markeringar",
        base.markers,
        local.markers,
        remote.markers,
        conflicts,
        resolution,
      ),
      cards: mergeCollection(
        "Anki-kort",
        base.cards,
        local.cards,
        remote.cards,
        conflicts,
        resolution,
      ),
      pendingAnkiDeletions: mergeCollection(
        "Anki-raderingar",
        base.pendingAnkiDeletions.map((item) => ({
          ...item,
          id: String(item.ankiId),
        })),
        local.pendingAnkiDeletions.map((item) => ({
          ...item,
          id: String(item.ankiId),
        })),
        remote.pendingAnkiDeletions.map((item) => ({
          ...item,
          id: String(item.ankiId),
        })),
        conflicts,
        resolution,
      ).map(({ id: _id, ...item }) => item),
      // Inställningar är enhetsspecifika: OAuth-koppling, synkmarkörer,
      // tema och lokala modeller får aldrig skapa en molnkonflikt eller
      // ersättas av en annan dator. Kursmaterialet ovan är det enda som
      // tillhör det delade biblioteket.
      settings: local.settings,
    } satisfies LibrarySyncSnapshot,
  };
}

/**
 * Recovery path for an installation that recognizes the same library but has
 * lost its local three-way-sync base (for example after an app-data restore).
 * It never infers deletions: unique objects from either side survive, while a
 * changed shared field is reported for an explicit user choice.
 */
export function mergeLibrarySnapshotsWithoutBase(
  local: LibrarySyncSnapshot,
  remote: LibrarySyncSnapshot,
  resolution?: MergeResolution,
) {
  const emptyBase: LibrarySyncSnapshot = {
    nodes: [],
    lectures: {},
    segments: [],
    markers: [],
    cards: [],
    pendingAnkiDeletions: [],
    // Settings are device-local. Keeping the local settings avoids unrelated
    // provider and credential configuration becoming a merge conflict.
    settings: local.settings,
  };
  return mergeLibrarySnapshots(emptyBase, local, remote, resolution);
}
