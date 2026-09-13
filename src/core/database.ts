import Dexie, { type EntityTable } from "dexie";
import type {
  RecordingChunk,
  LibraryBackup,
  RecordingSession,
  StoredAsset,
} from "./types";
import type { SyncV2State } from "../services/syncV2";
import { ASSET_DATABASE_NAME } from "../runtimeProfile";

export type InboxImportReceipt = {
  id: string;
  importedAt: string;
  lectureId: string;
};

export type VisualThumbnail = {
  id: string;
  assetId: string;
  visualId: string;
  blob: Blob;
  createdAt: string;
};

export type LibraryStateRecord = {
  id: string;
  serialized: string;
  schemaVersion: number;
  updatedAt: string;
  verifiedAt?: string;
};

export type StateMigrationBackup = {
  id: string;
  storageKey: string;
  serialized: string;
  createdAt: string;
};

export const DATABASE_NAME = ASSET_DATABASE_NAME;

export const db = new Dexie(DATABASE_NAME) as Dexie & {
  assets: EntityTable<StoredAsset, "id">;
  recordingSessions: EntityTable<RecordingSession, "id">;
  recordingChunks: EntityTable<RecordingChunk, "id">;
  backups: EntityTable<LibraryBackup, "id">;
  syncV2States: EntityTable<SyncV2State, "id">;
  inboxImports: EntityTable<InboxImportReceipt, "id">;
  visualThumbnails: EntityTable<VisualThumbnail, "id">;
  libraryStates: EntityTable<LibraryStateRecord, "id">;
  stateMigrationBackups: EntityTable<StateMigrationBackup, "id">;
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
// Sync v2 is self-contained; the v1 base snapshot is deliberately dropped.
db.version(8).stores({
  assets: "id, lectureId, nodeId, kind, createdAt",
  recordingSessions: "id, lectureId, status, createdAt",
  recordingChunks: "id, sessionId, [sessionId+sequence]",
  backups: "id, createdAt, reason",
  syncBases: null,
  syncV2States: "id, libraryId, updatedAt",
  inboxImports: "id, importedAt, lectureId",
});
db.version(9).stores({
  assets: "id, lectureId, nodeId, kind, createdAt",
  recordingSessions: "id, lectureId, status, createdAt",
  recordingChunks: "id, sessionId, [sessionId+sequence]",
  backups: "id, createdAt, reason",
  syncBases: null,
  syncV2States: "id, libraryId, updatedAt",
  inboxImports: "id, importedAt, lectureId",
  visualThumbnails: "id, assetId, visualId, createdAt",
});
db.version(10).stores({
  assets: "id, lectureId, nodeId, kind, createdAt",
  recordingSessions: "id, lectureId, status, createdAt",
  recordingChunks: "id, sessionId, [sessionId+sequence]",
  backups: "id, createdAt, reason",
  syncBases: null,
  syncV2States: "id, libraryId, updatedAt",
  inboxImports: "id, importedAt, lectureId",
  visualThumbnails: "id, assetId, visualId, createdAt",
  libraryStates: "id, updatedAt",
  stateMigrationBackups: "id, storageKey, createdAt",
});
