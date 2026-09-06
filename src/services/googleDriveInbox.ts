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

export type InboxAudioFile = Required<
  Pick<DriveFile, "id" | "name">
> &
  Pick<DriveFile, "mimeType" | "modifiedTime"> & {
    size: number;
  };

const audioExtension = /\.(m4a|mp3|wav|aac|ogg|opus|flac|webm|mp4)$/i;

async function inboxFolders(token: string) {
  const rootPath = useAppStore.getState().settings.cloudSync.remotePath.trim() || "Lectio";
  const root = await ensurePath(rootPath, token);
  const inbox = await ensureFolder("Inbox", root, token);
  const imported = await ensureFolder("Importerade", inbox, token);
  return { inbox, imported };
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
  return (result.files ?? [])
    .filter(
      (file) =>
        file.mimeType !== FOLDER_MIME &&
        (file.mimeType?.startsWith("audio/") || audioExtension.test(file.name)),
    )
    .map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      modifiedTime: file.modifiedTime,
      size: Number(file.size ?? 0),
    }))
    .sort((a, b) =>
      (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""),
    );
}

export async function downloadGoogleDriveInboxFile(file: InboxAudioFile) {
  const token = await getGoogleDriveAccessToken();
  const response = await googleDriveRequest(
    `${DRIVE_API}/files/${file.id}?alt=media`,
    token,
  );
  return response.blob();
}

/** Moves successfully imported recordings out of Inbox so they are never imported twice. */
export async function archiveGoogleDriveInboxFiles(fileIds: string[]) {
  if (!fileIds.length) return;
  const token = await getGoogleDriveAccessToken();
  const { inbox, imported } = await inboxFolders(token);
  await Promise.all(
    fileIds.map((id) =>
      googleDriveRequest(
        `${DRIVE_API}/files/${id}?addParents=${encodeURIComponent(imported)}&removeParents=${encodeURIComponent(inbox)}&fields=id`,
        token,
        { method: "PATCH" },
      ),
    ),
  );
}
