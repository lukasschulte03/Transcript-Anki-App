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
  return { inbox };
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

/** Locally records a completed import; Drive files stay in the simple Inbox folder. */
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
