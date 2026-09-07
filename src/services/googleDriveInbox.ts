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
import { useAppStore } from "../core/store";
import { db } from "../core/database";

export type InboxAudioFile = Required<Pick<DriveFile, "id" | "name">> &
  Pick<DriveFile, "mimeType" | "modifiedTime"> & {
    size: number;
  };

const audioExtension = /\.(m4a|mp3|wav|aac|ogg|opus|flac|webm|mp4)$/i;

async function inboxFolders(token: string) {
  const rootPath =
    useAppStore.getState().settings.cloudSync.remotePath.trim() || "Lectio";
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
