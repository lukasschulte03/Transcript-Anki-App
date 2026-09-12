import { db } from "../core/database";
import { useAppStore } from "../core/store";
import type { AppSettings, BackgroundJob, StoredAsset } from "../core/types";
import { uid } from "../lib/utils";
import { hasStorageCapacity } from "../lib/utils";
import { backupSourceFromState, createLibraryBackup } from "./libraryBackup";
import { netFetch } from "./platform";
import { logDiagnostic } from "./diagnosticLog";
import { getGoogleDriveAccessToken } from "./sync";
import type { LibrarySyncSnapshot } from "./libraryMerge";
import {
  applySyncOperations,
  createSyncOperations,
  findSyncConflicts,
  type SyncAsset,
  type SyncOperation,
  type SyncV2State,
} from "./syncV2";

export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

type RemoteAsset = SyncAsset;

type LibrarySnapshot = LibrarySyncSnapshot;

type SyncV2Checkpoint = {
  protocol: 2;
  schemaVersion?: 1;
  libraryId: string;
  createdAt: string;
  snapshot: LibrarySnapshot;
  assets: RemoteAsset[];
  knownOperationIds: string[];
};

/**
 * Settings belong to a device, not to the shared study library. Keeping them
 * out of the Drive payload prevents harmless values such as lastSyncedAt from
 * turning into cross-device merge conflicts when new app features are added.
 */
function snapshotForCloud(snapshot: LibrarySnapshot): LibrarySnapshot {
  return { ...snapshot, settings: {} as AppSettings };
}

export type DriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  parents?: string[];
};

function syncJob(patch: Record<string, unknown>) {
  useAppStore.getState().upsertJob({
    id: "sync:google-drive",
    kind: "library",
    label: "Google Drive-synk",
    phase: "syncing",
    status: "active",
    current: 0,
    ...patch,
  } as Omit<BackgroundJob, "startedAt" | "updatedAt">);
}

function getDeviceId() {
  const key = "lectio-google-drive-device-id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = uid();
  localStorage.setItem(key, id);
  return id;
}

export async function googleDriveRequest(
  url: string,
  token: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await netFetch(url, { ...init, headers });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 320);
    const error = new Error(
      `Google Drive svarade med ${response.status}${detail ? `: ${detail}` : ""}`,
    );
    logDiagnostic("sync", error, { level: "error", context: "Google Drive API" });
    throw error;
  }
  return response;
}

export function driveQuery(query: string, fields = "files(id,name,mimeType)") {
  return `${DRIVE_API}/files?${new URLSearchParams({
    q: query,
    spaces: "drive",
    fields,
    pageSize: "100",
  })}`;
}

function quote(value: string) {
  return value.replace(/'/g, "\\'");
}

export async function findNamedFile(
  name: string,
  parentId: string,
  token: string,
) {
  const query = `name='${quote(name)}' and '${parentId}' in parents and trashed=false`;
  const response = await googleDriveRequest(driveQuery(query), token);
  const result = (await response.json()) as { files?: DriveFile[] };
  return result.files?.[0];
}

async function listFiles(parentId: string, token: string) {
  const response = await googleDriveRequest(
    driveQuery(
      `'${parentId}' in parents and trashed=false`,
      "files(id,name,mimeType,modifiedTime)",
    ),
    token,
  );
  return ((await response.json()) as { files?: DriveFile[] }).files ?? [];
}

export async function ensureFolder(
  name: string,
  parentId: string,
  token: string,
) {
  const existing = await findNamedFile(name, parentId, token);
  if (existing?.mimeType === FOLDER_MIME) return existing.id;
  const response = await googleDriveRequest(
    `${DRIVE_API}/files?fields=id,name`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        parents: [parentId],
      }),
    },
  );
  return ((await response.json()) as DriveFile).id;
}

export async function ensurePath(path: string, token: string) {
  let parent = "root";
  for (const name of path
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)) {
    parent = await ensureFolder(name, parent, token);
  }
  return parent;
}

async function hash(blob: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function createResumableUpload(
  token: string,
  name: string,
  parentId: string,
  blob: Blob,
) {
  const response = await googleDriveRequest(
    `${DRIVE_UPLOAD}/files?uploadType=resumable&fields=id,name`,
    token,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": blob.type || "application/octet-stream",
        "X-Upload-Content-Length": String(blob.size),
      },
      body: JSON.stringify({ name, parents: [parentId] }),
    },
  );
  const location = response.headers.get("location");
  if (!location)
    throw new Error("Google Drive skapade ingen återupptagbar uppladdning.");
  const upload = await googleDriveRequest(location, token, {
    method: "PUT",
    headers: { "Content-Type": blob.type || "application/octet-stream" },
    body: blob,
  });
  return (await upload.json()) as DriveFile;
}

async function updateFile(token: string, id: string, blob: Blob) {
  await googleDriveRequest(
    `${DRIVE_UPLOAD}/files/${id}?uploadType=media`,
    token,
    {
      method: "PATCH",
      headers: { "Content-Type": blob.type || "application/octet-stream" },
      body: blob,
    },
  );
}

async function deleteFile(token: string, id: string) {
  await googleDriveRequest(`${DRIVE_API}/files/${id}`, token, {
    method: "DELETE",
  });
}

async function readSyncV2Checkpoint(token: string, metadataFolder: string) {
  const folder = await findNamedFile("sync-v2", metadataFolder, token);
  if (!folder?.id) return undefined;
  const file = await findNamedFile("checkpoint.json", folder.id, token);
  if (!file) return undefined;
  const response = await googleDriveRequest(
    `${DRIVE_API}/files/${file.id}?alt=media`,
    token,
  );
  const checkpoint = (await response.json()) as Partial<SyncV2Checkpoint>;
  if (
    checkpoint.protocol !== 2 ||
    !checkpoint.libraryId ||
    !checkpoint.snapshot
  )
    throw new Error("Sync v2-checkpointen i Google Drive är ogiltig.");
  return {
    folderId: folder.id,
    file,
    checkpoint: {
      ...(checkpoint as SyncV2Checkpoint),
      assets: Array.isArray(checkpoint.assets) ? checkpoint.assets : [],
      knownOperationIds: Array.isArray(checkpoint.knownOperationIds)
        ? checkpoint.knownOperationIds
        : [],
    },
  };
}

const localLibraryIsEmpty = (
  snapshot: LibrarySnapshot,
  assets: StoredAsset[],
) =>
  snapshot.nodes.length <= 1 &&
  !Object.keys(snapshot.lectures).length &&
  !assets.length;

function belongsToLibrary(
  asset: Pick<StoredAsset, "lectureId" | "nodeId">,
  snapshot: LibrarySnapshot,
) {
  return Boolean(
    (asset.nodeId && snapshot.nodes.some((node) => node.id === asset.nodeId)) ||
    (!asset.nodeId && snapshot.lectures[asset.lectureId]),
  );
}

const syncV2StateId = (rootPath: string) =>
  `google-drive-v2:${rootPath.toLocaleLowerCase()}`;

/**
 * Seeds the v2 protocol from an already verified v1 library. This is additive:
 * the old manifest remains untouched as a recovery checkpoint.
 */
async function seedSyncV2(
  rootPath: string,
  metadataFolder: string,
  snapshot: LibrarySnapshot,
  token: string,
  assets: RemoteAsset[] = [],
  knownOperationIds: string[] = [],
) {
  const stateId = syncV2StateId(rootPath);
  const existingState = await db.syncV2States.get(stateId);
  const libraryId = snapshot.nodes.find(
    (node) => node.type === "workspace",
  )?.id;
  if (!libraryId)
    throw new Error("Sync v2 kunde inte hitta bibliotekets rotobjekt.");
  const v2Folder = await ensureFolder("sync-v2", metadataFolder, token);
  const checkpoint = await findNamedFile("checkpoint.json", v2Folder, token);
  const payload = new Blob(
    [
      JSON.stringify({
        protocol: 2,
        schemaVersion: 1,
        libraryId,
        createdAt: new Date().toISOString(),
        snapshot: snapshotForCloud(snapshot),
        assets,
        knownOperationIds,
      } satisfies SyncV2Checkpoint),
    ],
    { type: "application/json" },
  );
  if (checkpoint) await updateFile(token, checkpoint.id, payload);
  else await createResumableUpload(token, "checkpoint.json", v2Folder, payload);
  const now = new Date().toISOString();
  await db.syncV2States.put({
    id: stateId,
    protocol: 2,
    // Older v2 state rows did not persist this field. Reading them as schema
    // one is an additive migration; the next successful sync writes it.
    schemaVersion: existingState?.schemaVersion ?? 1,
    libraryId,
    deviceId: getDeviceId(),
    nextSequence: existingState?.nextSequence ?? 1,
    base: snapshot,
    assets,
    knownOperationIds,
    createdAt: existingState?.createdAt ?? now,
    updatedAt: now,
  } satisfies SyncV2State);
}

async function readSyncV2Operations(
  folderId: string,
  token: string,
  known: Set<string>,
  libraryId: string,
) {
  const files = await listFiles(folderId, token);
  const operations: SyncOperation[] = [];
  for (const file of files) {
    if (!file.name.endsWith(".json") || file.name === "checkpoint.json")
      continue;
    const id = file.name.slice(0, -5);
    if (known.has(id)) continue;
    const response = await googleDriveRequest(
      `${DRIVE_API}/files/${file.id}?alt=media`,
      token,
    );
    const operation = (await response.json()) as SyncOperation;
    if (operation.id === id && operation.libraryId === libraryId)
      operations.push(operation);
  }
  return operations;
}

async function downloadRemoteLibrary(
  token: string,
  remote: Pick<SyncV2Checkpoint, "snapshot" | "assets">,
) {
  await downloadMissingRemoteAssets(token, remote.assets, remote.snapshot);
  const localCloud = useAppStore.getState().settings.cloudSync;
  useAppStore.getState().importLibrary({
    ...remote.snapshot,
    settings: { ...remote.snapshot.settings, cloudSync: localCloud },
  });
}

/**
 * A metadata merge can introduce a lecture that references media created on a
 * different device. Fetch only those immutable assets before materialising the
 * merged checkpoint; otherwise a later sync could accidentally omit them.
 */
async function downloadMissingRemoteAssets(
  token: string,
  remoteAssets: RemoteAsset[],
  snapshot: LibrarySnapshot,
) {
  const existingIds = new Set(
    (await db.assets.toArray()).map((asset) => asset.id),
  );
  const missing = remoteAssets.filter(
    (asset) => !existingIds.has(asset.id) && belongsToLibrary(asset, snapshot),
  );
  for (const [index, asset] of missing.entries()) {
    const response = await googleDriveRequest(
      `${DRIVE_API}/files/${asset.remoteId}?alt=media`,
      token,
    );
    const blob = await response.blob();
    if (!(await hasStorageCapacity(blob.size)))
      throw new Error(
        "Det finns inte tillräckligt lokalt lagringsutrymme för att hämta synkade filer. Frigör utrymme och försök igen.",
      );
    const { hash: _hash, remoteId: _remoteId, ...stored } = asset;
    await db.assets.put({ ...stored, blob });
    syncJob({
      phase: "downloading",
      current: index + 1,
      total: missing.length,
      detail: `Hämtar fil ${index + 1} av ${missing.length}…`,
    });
  }
}

/**
 * First Google Drive sync. Metadata is a small JSON manifest; each asset is an
 * immutable, content-addressed Drive file so unchanged recordings are skipped.
 * A non-empty local library and newer remote manifest are treated as a conflict
 * rather than silently overwriting study material.
 */
let activeGoogleDriveSync: Promise<void> | undefined;

/** A shared sync promise prevents startup, manual, and close syncs from racing. */
export function isGoogleDriveSyncActive() {
  return Boolean(activeGoogleDriveSync);
}

export function syncGoogleDrive() {
  if (activeGoogleDriveSync) return activeGoogleDriveSync;
  const task = syncGoogleDriveInternal();
  activeGoogleDriveSync = task;
  void task.then(
    () => {
      if (activeGoogleDriveSync === task) activeGoogleDriveSync = undefined;
    },
    () => {
      if (activeGoogleDriveSync === task) activeGoogleDriveSync = undefined;
    },
  );
  return task;
}

async function syncGoogleDriveInternal() {
  const state = useAppStore.getState();
  const token = await getGoogleDriveAccessToken();
  const rootPath = state.settings.cloudSync.remotePath.trim() || "Lectio";
  syncJob({
    phase: "preparing",
    current: 0,
    detail: "Förbereder Google Drive-synk…",
  });
  try {
    const root = await ensurePath(rootPath, token);
    const metadataFolder = await ensureFolder("metadata", root, token);
    const mediaFolder = await ensureFolder("media", root, token);
    let assets = await db.assets.toArray();
    let snapshot: LibrarySnapshot = {
      nodes: state.nodes,
      lectures: state.lectures,
      segments: state.segments,
      markers: state.markers,
      cards: state.cards,
      pendingAnkiDeletions: state.pendingAnkiDeletions,
      settings: state.settings,
    };
    const legacyManifestFile = await findNamedFile(
      "library.json",
      metadataFolder,
      token,
    );
    const checkpoint = await readSyncV2Checkpoint(token, metadataFolder);
    let v2State = await db.syncV2States.get(syncV2StateId(rootPath));
    let v2Folder: string | undefined;
    let v2Operations: SyncOperation[] = [];
    let conflictCount = 0;
    if (checkpoint && localLibraryIsEmpty(snapshot, assets)) {
      syncJob({
        phase: "downloading",
        current: 0,
        total: checkpoint.checkpoint.assets.length,
        detail: "Hämtar bibliotek från Google Drive…",
      });
      await downloadRemoteLibrary(token, checkpoint.checkpoint);
      await seedSyncV2(
        rootPath,
        metadataFolder,
        checkpoint.checkpoint.snapshot,
        token,
        checkpoint.checkpoint.assets,
        checkpoint.checkpoint.knownOperationIds,
      );
      useAppStore.getState().updateSettings({
        cloudSync: {
          ...useAppStore.getState().settings.cloudSync,
          remotePath: rootPath,
          lastSyncedAt: new Date().toISOString(),
        },
      });
      syncJob({
        phase: "complete",
        status: "complete",
        current: checkpoint.checkpoint.assets.length,
        total: checkpoint.checkpoint.assets.length,
        detail: "Biblioteket hämtades från Google Drive.",
      });
      return;
    }
    if (!v2State) {
      if (checkpoint) {
        await seedSyncV2(
          rootPath,
          metadataFolder,
          checkpoint.checkpoint.snapshot,
          token,
          checkpoint.checkpoint.assets,
          checkpoint.checkpoint.knownOperationIds,
        );
      } else {
        await seedSyncV2(rootPath, metadataFolder, snapshot, token);
      }
      v2State = await db.syncV2States.get(syncV2StateId(rootPath));
    }
    if (!v2State) throw new Error("Sync v2 kunde inte initieras.");
    {
      v2Folder = await ensureFolder("sync-v2", metadataFolder, token);
      const remoteOperations = await readSyncV2Operations(
        v2Folder,
        token,
        new Set(v2State.knownOperationIds),
        v2State.libraryId,
      );
      const local = createSyncOperations(v2State.base, snapshot, v2State);
      conflictCount = findSyncConflicts(
        local.operations,
        remoteOperations,
      ).length;
      v2Operations = [...remoteOperations, ...local.operations];
      snapshot = applySyncOperations(v2State.base, v2Operations);
      // Remote media is immutable and content-addressed. Only download assets
      // that the merged metadata can reference and that are absent locally.
      // This is intentionally before creating the next checkpoint.
      if (checkpoint) {
        await downloadMissingRemoteAssets(
          token,
          checkpoint.checkpoint.assets,
          snapshot,
        );
        assets = await db.assets.toArray();
      }
      v2State.nextSequence = local.nextSequence;
      const localAssetIds = new Set(
        assets
          .filter((asset) => belongsToLibrary(asset, snapshot))
          .map((asset) => asset.id),
      );
      const indexedAssetIds = new Set(v2State.assets.map((asset) => asset.id));
      const assetsChanged =
        localAssetIds.size !== indexedAssetIds.size ||
        [...localAssetIds].some((id) => !indexedAssetIds.has(id));
      // A routine startup/close sync with no local or remote changes must not
      // re-hash every recording or rewrite metadata. This keeps v2 fast even
      // for libraries with many large lectures.
      if (
        !v2Operations.length &&
        !assetsChanged &&
        checkpoint?.checkpoint.assets.length === v2State.assets.length
      ) {
        const completedAt = new Date().toISOString();
        useAppStore.getState().updateSettings({
          cloudSync: {
            ...useAppStore.getState().settings.cloudSync,
            remotePath: rootPath,
            lastSyncedAt: completedAt,
          },
        });
        syncJob({
          phase: "complete",
          status: "complete",
          current: 0,
          detail: "Biblioteket är redan uppdaterat.",
        });
        return;
      }
      // A merge/import can change many metadata references at once. Make the
      // recovery checkpoint here, after a no-op is known but before applying
      // any remote operation or mutating the sync base.
      await createLibraryBackup(
        "manual",
        backupSourceFromState(useAppStore.getState()),
      );
    }
    const syncAssets = assets.filter((asset) =>
      belongsToLibrary(asset, snapshot),
    );
    const remoteAssets: RemoteAsset[] = [];
    for (const [index, asset] of syncAssets.entries()) {
      syncJob({
        phase: "uploading",
        current: index,
        total: syncAssets.length + 1,
        detail: `Synkar fil ${index + 1} av ${syncAssets.length}…`,
      });
      const contentHash = await hash(asset.blob);
      const name = contentHash;
      const remote = await findNamedFile(name, mediaFolder, token);
      const uploaded =
        remote ??
        (await createResumableUpload(token, name, mediaFolder, asset.blob));
      const { blob: _blob, ...stored } = asset;
      remoteAssets.push({
        ...stored,
        hash: contentHash,
        remoteId: uploaded.id,
      });
    }
    const completedAt = new Date().toISOString();
    let knownOperationIds = v2State?.knownOperationIds ?? [];
    if (v2Folder) {
      for (const operation of v2Operations.filter(
        (item) => item.deviceId === getDeviceId(),
      )) {
        const existingOperation = await findNamedFile(
          `${operation.id}.json`,
          v2Folder,
          token,
        );
        if (!existingOperation)
          await createResumableUpload(
            token,
            `${operation.id}.json`,
            v2Folder,
            new Blob([JSON.stringify(operation)], { type: "application/json" }),
          );
      }
      knownOperationIds = [
        ...new Set([
          ...v2State!.knownOperationIds,
          ...v2Operations.map((item) => item.id),
        ]),
      ];
      await db.syncV2States.put({
        ...v2State!,
        base: snapshot,
        assets: remoteAssets,
        knownOperationIds,
        updatedAt: completedAt,
      });
    }
    await seedSyncV2(
      rootPath,
      metadataFolder,
      snapshot,
      token,
      remoteAssets,
      knownOperationIds,
    );
    // The v2 checkpoint is complete before the legacy manifest is removed.
    // A failed deletion merely leaves a harmless old recovery file behind.
    if (legacyManifestFile) await deleteFile(token, legacyManifestFile.id);
    const localCloud = useAppStore.getState().settings.cloudSync;
    useAppStore.getState().importLibrary({
      ...snapshot,
      settings: { ...snapshot.settings, cloudSync: localCloud },
    });
    useAppStore.getState().updateSettings({
      cloudSync: {
        ...useAppStore.getState().settings.cloudSync,
        remotePath: rootPath,
        lastSyncedAt: completedAt,
      },
    });
    syncJob({
      phase: "complete",
      status: "complete",
      current: syncAssets.length + 1,
      total: syncAssets.length + 1,
      detail: conflictCount
        ? `Synkade ${syncAssets.length} mediefiler. ${conflictCount} samtidiga ändring${conflictCount === 1 ? "" : "ar"} i samma fält fick den senaste versionen.`
        : `Synkade ${syncAssets.length} mediefiler och bibliotekets metadata.`,
    });
  } catch (error) {
    syncJob({
      phase: "error",
      status: "error",
      current: 0,
      detail: "Google Drive-synken misslyckades.",
    });
    throw error;
  }
}
