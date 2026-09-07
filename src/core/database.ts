import Dexie, { type EntityTable } from "dexie";
import type {
  RecordingChunk,
  LibraryBackup,
  RecordingSession,
  StoredAsset,
} from "./types";
import type { LibrarySyncSnapshot } from "../services/libraryMerge";

export type GoogleDriveSyncBase = {
  id: string;
  manifestUpdatedAt: string;
  snapshot: LibrarySyncSnapshot;
  assets: Array<{ id: string; hash: string; remoteId: string }>;
  createdAt: string;
};

export const db = new Dexie("lectio-assets") as Dexie & {
  assets: EntityTable<StoredAsset, "id">;
  recordingSessions: EntityTable<RecordingSession, "id">;
  recordingChunks: EntityTable<RecordingChunk, "id">;
  backups: EntityTable<LibraryBackup, "id">;
  syncBases: EntityTable<GoogleDriveSyncBase, "id">;
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
