import { db, type GoogleDriveSyncBase } from "../core/database";
import { useAppStore } from "../core/store";
import type { BackgroundJob, StoredAsset } from "../core/types";
import { uid } from "../lib/utils";
import { netFetch } from "./platform";
import { getGoogleDriveAccessToken } from "./sync";
import {
  mergeLibrarySnapshots,
  mergeLibrarySnapshotsWithoutBase,
  type LibrarySyncSnapshot,
  type MergeConflict,
  type MergeResolution,
} from "./libraryMerge";

export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

type RemoteAsset = Omit<StoredAsset, "blob"> & {
  hash: string;
  remoteId: string;
};

type LibrarySnapshot = LibrarySyncSnapshot;

type RemoteManifest = {
  format: "lectio-google-drive-v1";
  updatedAt: string;
  deviceId: string;
  snapshot: LibrarySnapshot;
  assets: RemoteAsset[];
};

export type DriveFile = { id: string; name: string; mimeType?: string; size?: string; modifiedTime?: string; parents?: string[] };

export class GoogleDriveMergeConflictError extends Error {
  readonly code = "google-drive-merge-conflict";
  readonly conflicts: MergeConflict[];
  constructor(conflicts: MergeConflict[]) {
    super("Samma information har ändrats på båda datorerna.");
    this.conflicts = conflicts;
  }
}

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

export async function googleDriveRequest(url: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await netFetch(url, { ...init, headers });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 320);
    throw new Error(`Google Drive svarade med ${response.status}${detail ? `: ${detail}` : ""}`);
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

export async function findNamedFile(name: string, parentId: string, token: string) {
  const query = `name='${quote(name)}' and '${parentId}' in parents and trashed=false`;
  const response = await googleDriveRequest(driveQuery(query), token);
  const result = (await response.json()) as { files?: DriveFile[] };
  return result.files?.[0];
}

export async function ensureFolder(name: string, parentId: string, token: string) {
  const existing = await findNamedFile(name, parentId, token);
  if (existing?.mimeType === FOLDER_MIME) return existing.id;
  const response = await googleDriveRequest(`${DRIVE_API}/files?fields=id,name`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  return ((await response.json()) as DriveFile).id;
}

export async function ensurePath(path: string, token: string) {
  let parent = "root";
  for (const name of path.split("/").map((part) => part.trim()).filter(Boolean)) {
    parent = await ensureFolder(name, parent, token);
  }
  return parent;
}

async function hash(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
  if (!location) throw new Error("Google Drive skapade ingen återupptagbar uppladdning.");
  const upload = await googleDriveRequest(location, token, {
    method: "PUT",
    headers: { "Content-Type": blob.type || "application/octet-stream" },
    body: blob,
  });
  return (await upload.json()) as DriveFile;
}

async function updateFile(token: string, id: string, blob: Blob) {
  await googleDriveRequest(`${DRIVE_UPLOAD}/files/${id}?uploadType=media`, token, {
    method: "PATCH",
    headers: { "Content-Type": blob.type || "application/octet-stream" },
    body: blob,
  });
}

async function readManifest(token: string, metadataFolder: string) {
  const file = await findNamedFile("library.json", metadataFolder, token);
  if (!file) return undefined;
  const response = await googleDriveRequest(`${DRIVE_API}/files/${file.id}?alt=media`, token);
  return { file, manifest: (await response.json()) as RemoteManifest };
}

const localLibraryIsEmpty = (snapshot: LibrarySnapshot, assets: StoredAsset[]) =>
  snapshot.nodes.length <= 1 && !Object.keys(snapshot.lectures).length && !assets.length;

const syncBaseId = (rootPath: string) => `google-drive:${rootPath.toLocaleLowerCase()}`;

function belongsToLibrary(asset: Pick<StoredAsset, "lectureId" | "nodeId">, snapshot: LibrarySnapshot) {
  return Boolean(
    (asset.nodeId && snapshot.nodes.some((node) => node.id === asset.nodeId)) ||
      (!asset.nodeId && snapshot.lectures[asset.lectureId]),
  );
}

async function saveSyncBase(rootPath: string, manifest: RemoteManifest) {
  await db.syncBases.put({
    id: syncBaseId(rootPath),
    manifestUpdatedAt: manifest.updatedAt,
    snapshot: manifest.snapshot,
    assets: manifest.assets.map(({ id, hash, remoteId }) => ({ id, hash, remoteId })),
    createdAt: new Date().toISOString(),
  } satisfies GoogleDriveSyncBase);
}

/**
 * A restored local backup can legitimately be missing `lastSyncedAt`.  Do not
 * mistake it for a different library merely because that bookkeeping value was
 * lost: Lectio's object IDs are stable across backup/export restoration.
 *
 * The workspace node is deliberately excluded: every library has one, so it
 * cannot prove that two libraries are related.
 */
export function isLikelySameGoogleDriveLibrary(
  local: Pick<LibrarySnapshot, "nodes" | "lectures">,
  remote: Pick<LibrarySnapshot, "nodes" | "lectures">,
  localAssets: Array<Pick<StoredAsset, "id">>,
  remoteAssets: Array<Pick<RemoteAsset, "id">>,
) {
  const remoteNodeIds = new Set(
    remote.nodes.filter((node) => node.type !== "workspace").map((node) => node.id),
  );
  if (local.nodes.some((node) => node.type !== "workspace" && remoteNodeIds.has(node.id))) return true;

  const remoteLectureIds = new Set(Object.keys(remote.lectures));
  if (Object.keys(local.lectures).some((id) => remoteLectureIds.has(id))) return true;

  const remoteAssetIds = new Set(remoteAssets.map((asset) => asset.id));
  return localAssets.some((asset) => remoteAssetIds.has(asset.id));
}

async function downloadRemoteLibrary(token: string, remote: RemoteManifest, rootPath: string) {
  const existingIds = new Set((await db.assets.toArray()).map((asset) => asset.id));
  for (const [index, asset] of remote.assets.entries()) {
    if (existingIds.has(asset.id)) continue;
    const response = await googleDriveRequest(`${DRIVE_API}/files/${asset.remoteId}?alt=media`, token);
    const blob = await response.blob();
    const { hash: _hash, remoteId: _remoteId, ...stored } = asset;
    await db.assets.put({ ...stored, blob });
    syncJob({
      phase: "downloading",
      current: index + 1,
      total: remote.assets.length,
      detail: `Hämtar fil ${index + 1} av ${remote.assets.length}…`,
    });
  }
  const localCloud = useAppStore.getState().settings.cloudSync;
  useAppStore.getState().importLibrary({
    ...remote.snapshot,
    settings: { ...remote.snapshot.settings, cloudSync: localCloud },
  });
  await saveSyncBase(rootPath, remote);
}

/**
 * First Google Drive sync. Metadata is a small JSON manifest; each asset is an
 * immutable, content-addressed Drive file so unchanged recordings are skipped.
 * A non-empty local library and newer remote manifest are treated as a conflict
 * rather than silently overwriting study material.
 */
export async function syncGoogleDrive(resolution?: MergeResolution) {
  const state = useAppStore.getState();
  const token = await getGoogleDriveAccessToken();
  const rootPath = state.settings.cloudSync.remotePath.trim() || "Lectio";
  syncJob({ phase: "preparing", current: 0, detail: "Förbereder Google Drive-synk…" });
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
    const existing = await readManifest(token, metadataFolder);
    const isRecoveredCopy = existing && isLikelySameGoogleDriveLibrary(
      snapshot,
      existing.manifest.snapshot,
      assets,
      existing.manifest.assets,
    );
    if (existing && localLibraryIsEmpty(snapshot, assets)) {
      syncJob({ phase: "downloading", current: 0, total: existing.manifest.assets.length, detail: "Hämtar bibliotek från Google Drive…" });
      await downloadRemoteLibrary(token, existing.manifest, rootPath);
      useAppStore.getState().updateSettings({
        cloudSync: { ...useAppStore.getState().settings.cloudSync, remotePath: rootPath, lastSyncedAt: new Date().toISOString() },
      });
      syncJob({ phase: "complete", status: "complete", current: existing.manifest.assets.length, total: existing.manifest.assets.length, detail: "Biblioteket hämtades från Google Drive." });
      return;
    }
    const syncBase = await db.syncBases.get(syncBaseId(rootPath));
    if (existing && (syncBase || isRecoveredCopy)) {
      const merged = syncBase
        ? mergeLibrarySnapshots(syncBase.snapshot, snapshot, existing.manifest.snapshot, resolution)
        : mergeLibrarySnapshotsWithoutBase(snapshot, existing.manifest.snapshot, resolution);
      if (merged.conflicts.length && !resolution) throw new GoogleDriveMergeConflictError(merged.conflicts);
      snapshot = merged.snapshot;
      const localAssetIds = new Set(assets.map((asset) => asset.id));
      const missingAssets = existing.manifest.assets.filter(
        (asset) => belongsToLibrary(asset, snapshot) && !localAssetIds.has(asset.id),
      );
      for (const [index, asset] of missingAssets.entries()) {
        syncJob({ phase: "downloading", current: index + 1, total: missingAssets.length, detail: `Hämtar ändrad fil ${index + 1} av ${missingAssets.length}…` });
        const response = await googleDriveRequest(`${DRIVE_API}/files/${asset.remoteId}?alt=media`, token);
        const blob = await response.blob();
        const { hash: _hash, remoteId: _remoteId, ...stored } = asset;
        await db.assets.put({ ...stored, blob });
      }
      assets = await db.assets.toArray();
    } else if (existing && state.settings.cloudSync.lastSyncedAt && existing.manifest.updatedAt > state.settings.cloudSync.lastSyncedAt) {
      throw new Error("Google Drive innehåller nyare ändringar, men denna installation saknar en synkbas för säker merge. Hämta biblioteket på en tom installation eller återställ en lokal backup först.");
    }
    if (existing && !state.settings.cloudSync.lastSyncedAt && !localLibraryIsEmpty(snapshot, assets) && !isRecoveredCopy) {
      throw new Error("Målmappen innehåller redan ett Lectio-bibliotek. Välj en tom mapp eller hämta biblioteket på en tom Lectio-installation först.");
    }
    const syncAssets = assets.filter((asset) => belongsToLibrary(asset, snapshot));
    const remoteAssets: RemoteAsset[] = [];
    for (const [index, asset] of syncAssets.entries()) {
      syncJob({ phase: "uploading", current: index, total: syncAssets.length + 1, detail: `Synkar fil ${index + 1} av ${syncAssets.length}…` });
      const contentHash = await hash(asset.blob);
      const name = contentHash;
      const remote = await findNamedFile(name, mediaFolder, token);
      const uploaded = remote ?? await createResumableUpload(token, name, mediaFolder, asset.blob);
      const { blob: _blob, ...stored } = asset;
      remoteAssets.push({ ...stored, hash: contentHash, remoteId: uploaded.id });
    }
    const manifest: RemoteManifest = {
      format: "lectio-google-drive-v1",
      updatedAt: new Date().toISOString(),
      deviceId: getDeviceId(),
      snapshot: {
        ...snapshot,
        settings: {
          ...snapshot.settings,
          cloudSync: { ...snapshot.settings.cloudSync, remotePath: rootPath },
        },
      },
      assets: remoteAssets,
    };
    const bytes = new Blob([JSON.stringify(manifest)], { type: "application/json" });
    if (existing) await updateFile(token, existing.file.id, bytes);
    else await createResumableUpload(token, "library.json", metadataFolder, bytes);
    const localCloud = useAppStore.getState().settings.cloudSync;
    useAppStore.getState().importLibrary({
      ...snapshot,
      settings: { ...snapshot.settings, cloudSync: localCloud },
    });
    await saveSyncBase(rootPath, manifest);
    useAppStore.getState().updateSettings({
      cloudSync: { ...useAppStore.getState().settings.cloudSync, remotePath: rootPath, lastSyncedAt: manifest.updatedAt },
    });
    syncJob({ phase: "complete", status: "complete", current: syncAssets.length + 1, total: syncAssets.length + 1, detail: `Synkade ${syncAssets.length} mediefiler och bibliotekets metadata.` });
  } catch (error) {
    syncJob({ phase: "error", status: "error", current: 0, detail: "Google Drive-synken misslyckades." });
    throw error;
  }
}
