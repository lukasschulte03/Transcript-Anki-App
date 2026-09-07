import Dexie, { type EntityTable } from "dexie";
import type {
  RecordingChunk,
  LibraryBackup,
  RecordingSession,
  StoredAsset,
} from "./types";
import type { LibrarySyncSnapshot } from "../services/libraryMerge";
import type { SyncV2State } from "../services/syncV2";

export type GoogleDriveSyncBase = {
  id: string;
  manifestUpdatedAt: string;
  snapshot: LibrarySyncSnapshot;
  assets: Array<{ id: string; hash: string; remoteId: string }>;
  createdAt: string;
};

export type InboxImportReceipt = {
  id: string;
  importedAt: string;
  lectureId: string;
};

export const db = new Dexie("lectio-assets") as Dexie & {
  assets: EntityTable<StoredAsset, "id">;
  recordingSessions: EntityTable<RecordingSession, "id">;
  recordingChunks: EntityTable<RecordingChunk, "id">;
  backups: EntityTable<LibraryBackup, "id">;
  syncBases: EntityTable<GoogleDriveSyncBase, "id">;
  syncV2States: EntityTable<SyncV2State, "id">;
  inboxImports: EntityTable<InboxImportReceipt, "id">;
};
db.version(1).stores({ assets: "id, lectureId, kind, createdAt" });
db.version(2).stores({
  assets: "id, lectureId, kind, createdAt",
  recordingSessions: "id, lectureId, status, createdAt",
  recordingChunks: "id, sessionId, [sessionId+sequence]",
});
db.version(3).stores({
  assets: "id, lectureId, nodeId, kind, createdAt",
  recordingSessions: "id, lectureId, status, createdAt",
  recordingChunks: "id, sessionId, [sessionId+sequence]",
});
db.version(4).stores({
  assets: "id, lectureId, nodeId, kind, createdAt",
  recordingSessions: "id, lectureId, status, createdAt",
  recordingChunks: "id, sessionId, [sessionId+sequence]",
  backups: "id, createdAt, reason",
});
db.version(5).stores({
  assets: "id, lectureId, nodeId, kind, createdAt",
  recordingSessions: "id, lectureId, status, createdAt",
  recordingChunks: "id, sessionId, [sessionId+sequence]",
  backups: "id, createdAt, reason",
  syncBases: "id, createdAt",
});
db.version(6).stores({
  assets: "id, lectureId, nodeId, kind, createdAt",
  recordingSessions: "id, lectureId, status, createdAt",
  recordingChunks: "id, sessionId, [sessionId+sequence]",
  backups: "id, createdAt, reason",
  syncBases: "id, createdAt",
  syncV2States: "id, libraryId, updatedAt",
});
db.version(7).stores({
  assets: "id, lectureId, nodeId, kind, createdAt",
  recordingSessions: "id, lectureId, status, createdAt",
  recordingChunks: "id, sessionId, [sessionId+sequence]",
  backups: "id, createdAt, reason",
  syncBases: "id, createdAt",
  syncV2States: "id, libraryId, updatedAt",
  inboxImports: "id, importedAt, lectureId",
});
