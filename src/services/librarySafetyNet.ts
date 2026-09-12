import { db } from "../core/database";
import type {
  AppSettings,
  Flashcard,
  LectureData,
  LibraryBackup,
  LibraryNode,
  Marker,
  TranscriptSegment,
} from "../core/types";
import {
  backupSourceFromState,
  createLibraryBackup,
  normalizeLibraryBackup,
  restoreBackupAssets,
} from "./libraryBackup";

function hasStudyMaterial(backup: LibraryBackup) {
  return backup.nodes.some((node) => node.type !== "workspace");
}

type LibraryStateSnapshot = {
  nodes: LibraryNode[];
  lectures: Record<string, LectureData>;
  segments: TranscriptSegment[];
  markers: Marker[];
  cards: Flashcard[];
  settings: AppSettings;
};

function libraryIsOnlyTheEmptyStarter(state: LibraryStateSnapshot) {
  return (
    state.nodes.every((node) => node.type === "workspace") &&
    !Object.keys(state.lectures).length &&
    !state.segments.length &&
    !state.markers.length &&
    !state.cards.length
  );
}

/**
 * Recovers from a lost browser profile only when the active state is the empty
 * starter library. This cannot replace a non-empty library and assets remain
 * in Dexie, independently of the Zustand/localStorage metadata record.
 */
export async function recoverEmptyLibrary(
  state: LibraryStateSnapshot,
  restore: (backup: LibraryBackup) => void,
) {
  if (!libraryIsOnlyTheEmptyStarter(state)) return null;
  const backups = await db.backups.orderBy("createdAt").reverse().toArray();
  const newestLibraryBackup = backups
    .map(normalizeLibraryBackup)
    .find(hasStudyMaterial);
  if (!newestLibraryBackup) return null;

  await restoreBackupAssets(newestLibraryBackup);
  restore(newestLibraryBackup);
  return newestLibraryBackup;
}

/** A small local checkpoint protects metadata even when the WebView profile is reset. */
export async function createAutomaticLibraryCheckpoint(state: LibraryStateSnapshot) {
  if (libraryIsOnlyTheEmptyStarter(state)) return null;
  return createLibraryBackup("automatic", backupSourceFromState(state));
}
