import { db } from "../core/database";
import type {
  AppSettings,
  Flashcard,
  LectureData,
  LibraryBackup,
  LibraryNode,
  Marker,
  StoredAsset,
  TranscriptSegment,
} from "../core/types";
import { uid } from "../lib/utils";

export type LibraryBackupSource = Pick<
  LibraryBackup,
  "nodes" | "lectures" | "segments" | "markers" | "cards" | "settings"
>;

export type NormalizedLibraryBackup = LibraryBackup;

/** Makes legacy metadata-only backups readable after the backup schema changed. */
export function normalizeLibraryBackup(value: Omit<LibraryBackup, "schemaVersion" | "assetIds"> & Partial<Pick<LibraryBackup, "schemaVersion" | "assetIds" | "retainedAssets">>): NormalizedLibraryBackup {
  return {
    ...value,
    schemaVersion: 2,
    assetIds: value.assetIds ?? [],
    retainedAssets: value.retainedAssets,
  };
}

function scopedAssets(
  assets: StoredAsset[],
  source: LibraryBackupSource,
) {
  const nodeIds = new Set(source.nodes.map((node) => node.id));
  const lectureIds = new Set(Object.keys(source.lectures));
  return assets.filter(
    (asset) =>
      lectureIds.has(asset.lectureId) ||
      (asset.nodeId !== undefined && nodeIds.has(asset.nodeId)),
  );
}

/**
 * Persists a metadata checkpoint. Binary data is copied only for destructive
 * operations; the normal path retains lightweight references to the originals.
 */
export async function createLibraryBackup(
  reason: LibraryBackup["reason"],
  source: LibraryBackupSource,
  options: { retainAssets?: StoredAsset[] } = {},
) {
  const allAssets = await db.assets.toArray();
  const referenced = scopedAssets(allAssets, source);
  const backup: LibraryBackup = {
    schemaVersion: 2,
    id: uid(),
    createdAt: new Date().toISOString(),
    reason,
    nodes: source.nodes,
    lectures: source.lectures,
    segments: source.segments,
    markers: source.markers,
    cards: source.cards,
    settings: source.settings,
    assetCount: referenced.length,
    assetIds: referenced.map((asset) => asset.id),
    retainedAssets: options.retainAssets?.length
      ? options.retainAssets
      : undefined,
  };
  await db.backups.put(backup);
  const all = await db.backups.orderBy("createdAt").toArray();
  const limit = Math.max(3, Math.min(50, source.settings.backupLimit ?? 10));
  if (all.length > limit)
    await db.backups.bulkDelete(all.slice(0, -limit).map((item) => item.id));
  return backup;
}

/** Restores copied destructive assets before the store restores their references. */
export async function restoreBackupAssets(backup: LibraryBackup) {
  if (backup.retainedAssets?.length)
    await db.transaction("rw", db.assets, async () => {
      await db.assets.bulkPut(backup.retainedAssets!);
    });
  const available = new Set(
    (await db.assets.bulkGet(backup.assetIds)).flatMap((asset) =>
      asset ? [asset.id] : [],
    ),
  );
  return {
    restored: backup.retainedAssets?.length ?? 0,
    missing: backup.assetIds.filter((id) => !available.has(id)).length,
  };
}

/** Kept explicit to make snapshot creation testable without Zustand or Dexie. */
export function backupSourceFromState(state: {
  nodes: LibraryNode[];
  lectures: Record<string, LectureData>;
  segments: TranscriptSegment[];
  markers: Marker[];
  cards: Flashcard[];
  settings: AppSettings;
}): LibraryBackupSource {
  return {
    nodes: state.nodes,
    lectures: state.lectures,
    segments: state.segments,
    markers: state.markers,
    cards: state.cards,
    settings: state.settings,
  };
}
