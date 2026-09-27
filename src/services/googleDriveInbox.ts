import { getGoogleDriveAccessToken } from "./sync";
import {
  DRIVE_API,
  FOLDER_MIME,
  driveQuery,
  ensureFolder,
  ensurePath,
  googleDriveRequest,
  type DriveFile,
} from "./googleDriveSync";
import { libraryRepository } from "../infrastructure/libraryRepository";
import { db } from "../core/database";
import type {
  InboxAudioFile,
  InboxImportProgress,
  InboxImportResult,
} from "../application/lectioClient";
import { confirmStorageForImport, uid } from "../lib/utils";

export type { InboxAudioFile } from "../application/lectioClient";

const audioExtension = /\.(m4a|mp3|wav|aac|ogg|opus|flac|webm|mp4)$/i;

async function inboxFolders(token: string) {
  const rootPath =
    libraryRepository.getState().settings.cloudSync.remotePath.trim() || "Lectio";
  const root = await ensurePath(rootPath, token);
  const inbox = await ensureFolder("Inbox", root, token);
  const media = await ensureFolder("media", root, token);
  return { inbox, media };
}

/** Lists only the user-managed Lectio/Inbox folder, never the rest of Drive. */
export async function listGoogleDriveInbox(): Promise<InboxAudioFile[]> {
  const token = await getGoogleDriveAccessToken();
  const { inbox } = await inboxFolders(token);
  const response = await googleDriveRequest(
    driveQuery(
      `'${inbox}' in parents and trashed=false`,
      "files(id,name,mimeType,size,modifiedTime,parents)",
    ),
    token,
  );
  const result = (await response.json()) as { files?: DriveFile[] };
  const imported = new Set(
    (await db.inboxImports.toArray()).map((receipt) => receipt.id),
  );
  return (result.files ?? [])
    .filter(
      (file) =>
        file.mimeType !== FOLDER_MIME &&
        (file.mimeType?.startsWith("audio/") || audioExtension.test(file.name)),
    )
    .filter((file) => !imported.has(file.id))
    .map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      modifiedTime: file.modifiedTime,
      size: Number(file.size ?? 0),
    }))
    .sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""));
}

export async function downloadGoogleDriveInboxFile(file: InboxAudioFile) {
  const token = await getGoogleDriveAccessToken();
  const response = await googleDriveRequest(
    `${DRIVE_API}/files/${file.id}?alt=media`,
    token,
  );
  return response.blob();
}

/** Locally records a completed import so retries never create duplicate assets. */
export async function markGoogleDriveInboxFilesImported(
  fileIds: string[],
  lectureId: string,
) {
  await db.inboxImports.bulkPut(
    fileIds.map((id) => ({
      id,
      lectureId,
      importedAt: new Date().toISOString(),
    })),
  );
}

/** Move a source recording to the canonical, content-addressed media folder. */
export async function moveGoogleDriveInboxFilesToMedia(
  files: Array<{
    id: string;
    assetId: string;
    contentHash: string;
    originalName: string;
  }>,
  lectureId: string,
) {
  if (!files.length) return;
  const token = await getGoogleDriveAccessToken();
  const { inbox, media } = await inboxFolders(token);
  await Promise.all(
    files.map(({ id, assetId, contentHash, originalName }) =>
      googleDriveRequest(
        `${DRIVE_API}/files/${id}?addParents=${encodeURIComponent(media)}&removeParents=${encodeURIComponent(inbox)}&fields=id,name`,
        token,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: contentHash,
            appProperties: {
              lectioAssetId: assetId,
              lectioLectureId: lectureId,
              lectioKind: "audio",
              lectioOriginalName: originalName,
            },
          }),
        },
      ),
    ),
  );
}

async function contentHash(blob: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Imports a set of remote recordings as one local transaction. Receipts are
 * written only after every local asset and the lecture reference are durable.
 */
export async function importGoogleDriveInboxFiles(
  files: InboxAudioFile[],
  lectureId: string,
  progress?: (value: InboxImportProgress) => void,
): Promise<InboxImportResult> {
  if (!files.length) throw new Error("Välj minst en ljudfil först.");
  const state = libraryRepository.getState();
  const lectureNode = state.nodes.find(
    (node) => node.id === lectureId && node.type === "lecture",
  );
  if (!lectureNode) throw new Error("Föreläsningen kunde inte hittas.");

  const lecture = state.lectures[lectureId];
  const existingParts = lecture?.audioParts?.length
    ? lecture.audioParts
    : lecture?.audioAssetId
      ? [
          {
            assetId: lecture.audioAssetId,
            name: lecture.audioName ?? "Ljudinspelning",
            duration: lecture.audioDuration,
          },
        ]
      : [];
  const createdAssetIds: string[] = [];
  const parts: { assetId: string; name: string }[] = [];
  const movedFiles: Array<{
    id: string;
    assetId: string;
    contentHash: string;
    originalName: string;
  }> = [];
  let lectureUpdated = false;

  try {
    for (const [index, file] of files.entries()) {
      progress?.({
        completed: index,
        total: files.length,
        detail: `Hämtar ${file.name}`,
      });
      const blob = await downloadGoogleDriveInboxFile(file);
      if (!(await confirmStorageForImport(blob, "ljudfilen"))) {
        throw new Error("Importen avbröts på grund av ledigt utrymme.");
      }
      const assetId = uid();
      await db.assets.put({
        id: assetId,
        lectureId,
        kind: "audio",
        name: file.name,
        mimeType: file.mimeType || blob.type || "audio/mpeg",
        blob,
        createdAt: new Date().toISOString(),
      });
      createdAssetIds.push(assetId);
      parts.push({ assetId, name: file.name });
      movedFiles.push({
        id: file.id,
        assetId,
        contentHash: await contentHash(blob),
        originalName: file.name,
      });
      progress?.({
        completed: index + 1,
        total: files.length,
        detail: `${file.name} är sparad`,
      });
    }

    const audioParts = [...existingParts, ...parts];
    libraryRepository.getState().updateLecture(lectureId, {
      audioAssetId: audioParts[0]?.assetId,
      audioName: audioParts[0]?.name,
      audioParts,
    });
    lectureUpdated = true;
    await markGoogleDriveInboxFilesImported(
      files.map((file) => file.id),
      lectureId,
    );
  } catch (error) {
    if (lectureUpdated) {
      libraryRepository.getState().updateLecture(lectureId, {
        audioAssetId: lecture?.audioAssetId,
        audioName: lecture?.audioName,
        audioDuration: lecture?.audioDuration,
        audioParts: lecture?.audioParts,
      });
    }
    if (createdAssetIds.length) await db.assets.bulkDelete(createdAssetIds);
    throw error;
  }

  let remoteMoveFailed = false;
  try {
    await moveGoogleDriveInboxFilesToMedia(movedFiles, lectureId);
  } catch {
    remoteMoveFailed = true;
  }
  return { imported: files.length, lectureId, remoteMoveFailed };
}
