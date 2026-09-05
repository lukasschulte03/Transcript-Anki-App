import Dexie, { type EntityTable } from "dexie";
import type {
  RecordingChunk,
  RecordingSession,
  StoredAsset,
} from "./types";

export const db = new Dexie("lectio-assets") as Dexie & {
  assets: EntityTable<StoredAsset, "id">;
  recordingSessions: EntityTable<RecordingSession, "id">;
  recordingChunks: EntityTable<RecordingChunk, "id">;
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
