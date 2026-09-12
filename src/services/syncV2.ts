import type {
  AppSettings,
  Flashcard,
  LectureData,
  LibraryNode,
  Marker,
  TranscriptSegment,
} from "../core/types";
import type { LibrarySyncSnapshot } from "./libraryMerge";

/** Immutable Drive object metadata; blobs remain in IndexedDB locally. */
export type SyncAsset = Omit<
  import("../core/types").StoredAsset,
  "blob"
> & {
  hash: string;
  remoteId: string;
};

/** Provider-neutral, immutable operation used by Sync v2 transports. */
export type SyncOperation = {
  id: string;
  libraryId: string;
  deviceId: string;
  sequence: number;
  at: string;
  collection:
    | "nodes"
    | "lectures"
    | "segments"
    | "markers"
    | "cards"
    | "pendingAnkiDeletions";
  entityId: string;
  kind: "upsert" | "delete";
  /** Only changed fields are written, so unrelated edits merge naturally. */
  patch?: Record<string, unknown>;
};

export type SyncConflict = {
  collection: SyncOperation["collection"];
  entityId: string;
  field: string;
};

export type SyncV2State = {
  id: string;
  protocol: 2;
  /** Version of the operation payload independently of the transport. */
  schemaVersion: 1;
  libraryId: string;
  deviceId: string;
  nextSequence: number;
  /** Materialized shared state after the last successful sync. */
  base: LibrarySyncSnapshot;
  /** Content-addressed media index used for incremental v2 transfers. */
  assets: SyncAsset[];
  knownOperationIds: string[];
  createdAt: string;
  updatedAt: string;
};

const collections = [
  "nodes",
  "lectures",
  "segments",
  "markers",
  "cards",
  "pendingAnkiDeletions",
] as const;
type SyncCollection = (typeof collections)[number];
type Entity =
  | LibraryNode
  | LectureData
  | TranscriptSegment
  | Marker
  | Flashcard
  | { ankiId: number; lectureId?: string; error?: string; updatedAt?: string };

const stable = (value: unknown) => JSON.stringify(value);
const operationOrder = (left: SyncOperation, right: SyncOperation) =>
  left.at.localeCompare(right.at) ||
  left.deviceId.localeCompare(right.deviceId) ||
  left.sequence - right.sequence ||
  left.id.localeCompare(right.id);

function keyFor(collection: SyncCollection, entity: Entity) {
  return collection === "lectures"
    ? (entity as LectureData).lectureId
    : collection === "pendingAnkiDeletions"
      ? String((entity as { ankiId: number }).ankiId)
      : (entity as { id: string }).id;
}

function entities(
  snapshot: LibrarySyncSnapshot,
  collection: SyncCollection,
): Entity[] {
  if (collection === "lectures") return Object.values(snapshot.lectures);
  if (collection === "pendingAnkiDeletions")
    return snapshot.pendingAnkiDeletions;
  return snapshot[collection] as Entity[];
}

function changedFields(before: Entity | undefined, after: Entity) {
  const patch: Record<string, unknown> = {};
  const beforeRecord = (before ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(after as Record<string, unknown>)) {
    if (stable(beforeRecord[key]) !== stable(value)) patch[key] = value;
  }
  return patch;
}

/** Creates a small, append-only diff from the last materialized shared state. */
export function createSyncOperations(
  base: LibrarySyncSnapshot,
  current: LibrarySyncSnapshot,
  options: Pick<SyncV2State, "libraryId" | "deviceId" | "nextSequence"> & {
    at?: string;
  },
) {
  let sequence = options.nextSequence;
  const at = options.at ?? new Date().toISOString();
  const operations: SyncOperation[] = [];
  for (const collection of collections) {
    const before = new Map(
      entities(base, collection).map((entity) => [
        keyFor(collection, entity),
        entity,
      ]),
    );
    const after = new Map(
      entities(current, collection).map((entity) => [
        keyFor(collection, entity),
        entity,
      ]),
    );
    for (const [entityId, entity] of after) {
      const patch = changedFields(before.get(entityId), entity);
      if (!Object.keys(patch).length) continue;
      operations.push({
        id: `${options.deviceId}:${sequence}`,
        libraryId: options.libraryId,
        deviceId: options.deviceId,
        sequence: sequence++,
        at,
        collection,
        entityId,
        kind: "upsert",
        patch,
      });
    }
    for (const entityId of before.keys()) {
      if (!after.has(entityId))
        operations.push({
          id: `${options.deviceId}:${sequence}`,
          libraryId: options.libraryId,
          deviceId: options.deviceId,
          sequence: sequence++,
          at,
          collection,
          entityId,
          kind: "delete",
        });
    }
  }
  return { operations, nextSequence: sequence };
}

function cloneSnapshot(snapshot: LibrarySyncSnapshot): LibrarySyncSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as LibrarySyncSnapshot;
}

/**
 * Applies operations in a deterministic order. Deletions are tombstones: an
 * older device cannot resurrect an item after it has been removed remotely.
 * Settings are deliberately never part of the protocol.
 */
export function applySyncOperations(
  base: LibrarySyncSnapshot,
  operations: SyncOperation[],
) {
  const result = cloneSnapshot(base);
  const tombstones = new Map<string, SyncOperation>();
  const fieldVersions = new Map<string, SyncOperation>();
  const sorted = [...operations].sort(operationOrder);
  for (const operation of sorted) {
    const tombstoneKey = `${operation.collection}:${operation.entityId}`;
    const deletedBy = tombstones.get(tombstoneKey);
    if (deletedBy && operationOrder(deletedBy, operation) >= 0) continue;
    if (operation.kind === "delete") {
      tombstones.set(tombstoneKey, operation);
      if (operation.collection === "lectures")
        delete result.lectures[operation.entityId];
      else if (operation.collection === "pendingAnkiDeletions")
        result.pendingAnkiDeletions = result.pendingAnkiDeletions.filter(
          (item) => String(item.ankiId) !== operation.entityId,
        );
      else
        result[operation.collection] = (
          result[operation.collection] as Array<{ id: string }>
        ).filter((item) => item.id !== operation.entityId) as never;
      continue;
    }
    if (deletedBy) continue;
    const patch = operation.patch ?? {};
    if (operation.collection === "lectures") {
      const current = result.lectures[operation.entityId] ?? {
        lectureId: operation.entityId,
        notes: "",
      };
      const next = { ...current } as Record<string, unknown>;
      for (const [field, value] of Object.entries(patch)) {
        const fieldKey = `${tombstoneKey}:${field}`;
        if (
          !fieldVersions.has(fieldKey) ||
          operationOrder(fieldVersions.get(fieldKey)!, operation) <= 0
        ) {
          next[field] = value;
          fieldVersions.set(fieldKey, operation);
        }
      }
      result.lectures[operation.entityId] = next as unknown as LectureData;
      continue;
    }
    const list =
      operation.collection === "pendingAnkiDeletions"
        ? result.pendingAnkiDeletions
        : (result[operation.collection] as Entity[]);
    const index = list.findIndex(
      (item) => keyFor(operation.collection, item) === operation.entityId,
    );
    const current =
      index >= 0
        ? list[index]
        : operation.collection === "pendingAnkiDeletions"
          ? { ankiId: Number(operation.entityId) }
          : { id: operation.entityId };
    const next = { ...current } as Record<string, unknown>;
    for (const [field, value] of Object.entries(patch)) {
      const fieldKey = `${tombstoneKey}:${field}`;
      if (
        !fieldVersions.has(fieldKey) ||
        operationOrder(fieldVersions.get(fieldKey)!, operation) <= 0
      ) {
        next[field] = value;
        fieldVersions.set(fieldKey, operation);
      }
    }
    if (index >= 0) list[index] = next as never;
    else list.push(next as never);
  }
  return result;
}

/**
 * Only simultaneous writes to the same field are worth surfacing. Independent
 * edits merge field-by-field; an entity deletion remains a deterministic
 * tombstone rather than a prompt that could resurrect study material.
 */
export function findSyncConflicts(
  local: SyncOperation[],
  remote: SyncOperation[],
): SyncConflict[] {
  const conflicts = new Map<string, SyncConflict>();
  for (const left of local) {
    if (left.kind !== "upsert") continue;
    for (const right of remote) {
      if (
        right.kind !== "upsert" ||
        left.collection !== right.collection ||
        left.entityId !== right.entityId
      ) continue;
      for (const field of Object.keys(left.patch ?? {})) {
        if (
          field in (right.patch ?? {}) &&
          stable(left.patch?.[field]) !== stable(right.patch?.[field])
        ) {
          const key = `${left.collection}:${left.entityId}:${field}`;
          conflicts.set(key, { collection: left.collection, entityId: left.entityId, field });
        }
      }
    }
  }
  return [...conflicts.values()];
}

/** Keeps the v2 wire format free from all device-local preferences. */
export function sharedSnapshot(
  snapshot: LibrarySyncSnapshot,
): LibrarySyncSnapshot {
  return { ...snapshot, settings: {} as AppSettings };
}
