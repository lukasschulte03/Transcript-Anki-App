import { db } from "../core/database";
import { libraryRepository } from "../infrastructure/libraryRepository";
import { uid } from "../lib/utils";

/** Durable chunks keep long recordings out of the renderer's JS heap. */
export async function startRecording(lectureId: string, mimeType: string) {
  if (!libraryRepository.getState().lectures[lectureId])
    throw new Error("Föreläsningen kunde inte hittas");
  const id = uid();
  const extension = mimeType.includes("mp4") ? "m4a" : "webm";
  await db.recordingSessions.put({
    id,
    lectureId,
    mimeType,
    duration: 0,
    status: "recording",
    name: `Inspelning ${new Date().toLocaleString("sv-SE").replaceAll(":", "-")}.${extension}`,
    createdAt: new Date().toISOString(),
  });
  return id;
}

export async function appendRecording(
  id: string,
  sequence: number,
  blob: Blob,
  duration: number,
) {
  await db.transaction(
    "rw",
    db.recordingSessions,
    db.recordingChunks,
    async () => {
      if (!(await db.recordingSessions.get(id)))
        throw new Error("Inspelningen kunde inte hittas");
      await db.recordingChunks.put({
        id: `${id}-${sequence}`,
        sessionId: id,
        sequence,
        blob,
      });
      await db.recordingSessions.update(id, { duration });
    },
  );
}

export async function finishRecording(id: string, duration?: number) {
  const session = await db.recordingSessions.get(id);
  if (!session) throw new Error("Inspelningen kunde inte hittas");
  const lecture = libraryRepository.getState().lectures[session.lectureId];
  if (!lecture) throw new Error("Föreläsningen kunde inte hittas");
  const chunks = await db.recordingChunks
    .where("sessionId")
    .equals(id)
    .sortBy("sequence");
  if (!chunks.length)
    throw new Error("Inspelningen innehåller inga sparade ljuddelar");
  // Stable asset ID makes recovery retryable without duplicate attachments.
  const assetId = `recording-${id}`;
  const blob = new Blob(
    chunks.map((chunk) => chunk.blob),
    { type: session.mimeType },
  );
  await db.assets.put({
    id: assetId,
    lectureId: session.lectureId,
    kind: "audio",
    name: session.name,
    mimeType: session.mimeType,
    blob,
    createdAt: session.createdAt,
  });
  const previous = lecture.audioParts?.length
    ? lecture.audioParts
    : lecture.audioAssetId
      ? [
          {
            assetId: lecture.audioAssetId,
            name: lecture.audioName ?? "Ljud",
            duration: lecture.audioDuration,
          },
        ]
      : [];
  const parts = [
    ...previous.filter((part) => part.assetId !== assetId),
    {
      assetId,
      name: session.name,
      duration: Math.max(0, duration ?? session.duration),
    },
  ];
  libraryRepository.getState().updateLecture(session.lectureId, {
    audioParts: parts,
    audioAssetId: parts[0].assetId,
    audioName: parts[0].name,
    audioDuration: parts.reduce((sum, part) => sum + (part.duration ?? 0), 0),
  });
  await db.transaction(
    "rw",
    db.recordingSessions,
    db.recordingChunks,
    async () => {
      await db.recordingChunks.where("sessionId").equals(id).delete();
      await db.recordingSessions.delete(id);
    },
  );
  return assetId;
}
