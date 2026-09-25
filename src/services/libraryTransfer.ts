import { strFromU8, strToU8, unzip, zip } from "fflate";
import type {
  LibrarySnapshot,
  LibraryTransferProgress,
} from "../application/lectioClient";
import { db } from "../core/database";
import type { StoredAsset } from "../core/types";
import { libraryRepository } from "../infrastructure/libraryRepository";
import { downloadBlob, hasStorageCapacity } from "../lib/utils";
import {
  backupSourceFromState,
  createLibraryBackup,
  normalizeLibraryBackup,
  restoreBackupAssets,
} from "./libraryBackup";

const MAX_BYTES = 1536 * 1024 * 1024;
type Progress = (value: LibraryTransferProgress) => void;
let transferring = false;

async function exclusive<T>(action: () => Promise<T>): Promise<T> {
  if (transferring) throw new Error("En biblioteksöverföring pågår redan.");
  transferring = true;
  try {
    return await action();
  } finally {
    transferring = false;
  }
}

/** Never spread untrusted exports into the store (actions, settings or sync identity). */
export function parseLibraryTransfer(raw: unknown): LibrarySnapshot {
  if (!raw || typeof raw !== "object")
    throw new Error("Filen är inte en Lectio-export.");
  const data = raw as Record<string, unknown>;
  if (data.version !== 1) throw new Error("Exportens version stöds inte.");
  for (const field of ["nodes", "segments", "markers", "cards"])
    if (!Array.isArray(data[field]))
      throw new Error(`Exporten saknar ${field}.`);
  if (
    !data.lectures ||
    typeof data.lectures !== "object" ||
    Array.isArray(data.lectures)
  )
    throw new Error("Exporten saknar föreläsningsdata.");
  const snapshot = data as unknown as LibrarySnapshot;
  if (snapshot.nodes.length > 5000)
    throw new Error("Exporten innehåller för många objekt.");
  const parents = new Map<string, string | null>();
  for (const node of snapshot.nodes) {
    if (
      !node ||
      typeof node.id !== "string" ||
      !node.id ||
      parents.has(node.id) ||
      typeof node.title !== "string" ||
      !["workspace", "course", "module", "topic", "lecture"].includes(
        node.type,
      ) ||
      (node.parentId !== null && typeof node.parentId !== "string")
    )
      throw new Error("Exporten har ogiltiga biblioteksobjekt.");
    parents.set(node.id, node.parentId);
  }
  for (const id of parents.keys()) {
    const seen = new Set<string>();
    let cursor: string | null = id;
    while (cursor !== null) {
      if (seen.has(cursor) || !parents.has(cursor))
        throw new Error("Exportens biblioteksträd är skadat.");
      seen.add(cursor);
      cursor = parents.get(cursor)!;
    }
  }
  for (const field of ["segments", "markers", "cards"] as const)
    for (const entry of snapshot[field])
      if (
        !entry ||
        typeof entry.id !== "string" ||
        typeof entry.lectureId !== "string"
      )
        throw new Error(`Exporten innehåller ogiltiga ${field}.`);
  return {
    nodes: snapshot.nodes,
    lectures: snapshot.lectures,
    segments: snapshot.segments,
    markers: snapshot.markers,
    cards: snapshot.cards,
  };
}

export async function importLibraryFile(
  file: Blob,
  name: string,
  progress: Progress = () => {},
) {
  return exclusive(async () => {
    if (file.size > MAX_BYTES)
      throw new Error("Exporten är för stor. Maximal storlek är 1,5 GB.");
    progress({ completed: 0, detail: "Läser och kontrollerar exporten…" });
    let raw: unknown;
    const assets: StoredAsset[] = [];
    if (/\.zip$/i.test(name)) {
      let expanded = 0;
      let rejected = false;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const archive = await new Promise<Record<string, Uint8Array>>(
        (resolve, reject) => {
          unzip(
            bytes,
            {
              filter: (entry) => {
                expanded += entry.originalSize;
                if (expanded > MAX_BYTES) rejected = true;
                return !rejected;
              },
            },
            (error, files) => (error ? reject(error) : resolve(files)),
          );
        },
      );
      if (rejected)
        throw new Error("Det uppackade arkivet är större än 1,5 GB.");
      if (!archive["library.json"])
        throw new Error("library.json saknas i arkivet.");
      raw = JSON.parse(strFromU8(archive["library.json"]));
      const manifest: unknown = archive["assets.json"]
        ? JSON.parse(strFromU8(archive["assets.json"]))
        : [];
      if (!Array.isArray(manifest) || manifest.length > 5000)
        throw new Error("Arkivets fillista är ogiltig.");
      const ids = new Set<string>();
      for (const item of manifest) {
        if (
          !item ||
          typeof item.id !== "string" ||
          !item.id ||
          ids.has(item.id) ||
          typeof item.path !== "string" ||
          !item.path.startsWith("media/") ||
          item.path.includes("..") ||
          !archive[item.path] ||
          typeof item.name !== "string" ||
          typeof item.mimeType !== "string" ||
          typeof item.lectureId !== "string"
        )
          throw new Error("Arkivet innehåller en ogiltig mediafil.");
        ids.add(item.id);
        const { path, ...metadata } = item;
        assets.push({
          ...metadata,
          blob: new Blob([archive[path] as BlobPart], { type: item.mimeType }),
        });
      }
    } else if (/\.json$/i.test(name)) raw = JSON.parse(await file.text());
    else throw new Error("Välj en ZIP- eller JSON-export från Lectio.");
    const snapshot = parseLibraryTransfer(raw);
    if (!(await hasStorageCapacity(file.size * 2)))
      throw new Error(
        "Det finns inte tillräckligt med ledigt lagringsutrymme för importen och säkerhetskopian.",
      );
    progress({
      completed: 0,
      detail: "Säkerhetskopierar det nuvarande biblioteket…",
    });
    const overwritten = (
      await db.assets.bulkGet(assets.map((asset) => asset.id))
    ).filter((asset): asset is StoredAsset => Boolean(asset));
    await createLibraryBackup(
      "import",
      backupSourceFromState(libraryRepository.getState()),
      { retainAssets: overwritten },
    );
    await db.transaction("rw", db.assets, async () => {
      for (const [index, asset] of assets.entries()) {
        await db.assets.put(asset);
        progress({
          completed: index + 1,
          total: assets.length + 1,
          detail: `Läser in fil ${index + 1} av ${assets.length}…`,
        });
      }
    });
    libraryRepository.getState().importLibrary(snapshot);
    progress({
      completed: 1,
      total: 1,
      detail: "Biblioteket har importerats.",
    });
  });
}

export async function exportLibrary(progress: Progress = () => {}) {
  return exclusive(async () => {
    const snapshot = backupSourceFromState(libraryRepository.getState());
    const { settings: _settings, ...library } = snapshot;
    const ownerIds = new Set(snapshot.nodes.map((node) => node.id));
    const assets = await db.assets
      .filter((asset) => ownerIds.has(asset.nodeId ?? asset.lectureId))
      .toArray();
    if (assets.reduce((sum, asset) => sum + asset.blob.size, 0) > MAX_BYTES)
      throw new Error(
        "Biblioteket är större än 1,5 GB och kan inte exporteras i ett enda arkiv här.",
      );
    const files: Record<string, Uint8Array> = {
      "library.json": strToU8(
        JSON.stringify({
          version: 1,
          exportedAt: new Date().toISOString(),
          ...library,
        }),
      ),
    };
    const manifest = [];
    for (const [index, asset] of assets.entries()) {
      const { blob, ...metadata } = asset;
      const path = `media/${index}-${asset.name.replace(/[<>:"/\\|?*]/g, "_")}`;
      files[path] = new Uint8Array(await blob.arrayBuffer());
      manifest.push({ ...metadata, path });
      progress({
        completed: index + 1,
        total: assets.length + 1,
        detail: `Förbereder fil ${index + 1} av ${assets.length}…`,
      });
    }
    files["assets.json"] = strToU8(JSON.stringify(manifest));
    progress({
      completed: assets.length,
      total: assets.length + 1,
      detail: "Packar exporten…",
    });
    const bytes = await new Promise<Uint8Array>((resolve, reject) =>
      zip(files, { level: 0 }, (error, data) =>
        error ? reject(error) : resolve(data),
      ),
    );
    downloadBlob(
      `lectio-export-${new Date().toISOString().slice(0, 10)}.zip`,
      new Blob([bytes as BlobPart], { type: "application/zip" }),
    );
    progress({
      completed: 1,
      total: 1,
      detail: "Exporten har skickats till dina nedladdningar.",
    });
  });
}

export async function listLibraryBackups() {
  const backups: Array<{ id: string; createdAt: string; nodes: number }> = [];
  await db.backups
    .orderBy("createdAt")
    .reverse()
    .each(({ id, createdAt, nodes }) => {
      backups.push({ id, createdAt, nodes: nodes.length });
    });
  return backups;
}

export async function restoreLibraryCheckpoint(id: string) {
  return exclusive(async () => {
    const raw = await db.backups.get(id);
    if (!raw) throw new Error("Återställningspunkten finns inte kvar.");
    const backup = normalizeLibraryBackup(raw);
    const keys = new Set(await db.assets.toCollection().primaryKeys());
    const retained = new Set(backup.retainedAssets?.map((asset) => asset.id));
    if (
      backup.assetIds.some(
        (assetId) => !keys.has(assetId) && !retained.has(assetId),
      )
    )
      throw new Error(
        "Återställningspunkten saknar mediafiler. Använd en fullständig ZIP-export istället.",
      );
    const previous = backupSourceFromState(libraryRepository.getState());
    const collisions = (
      await db.assets.bulkGet(
        backup.retainedAssets?.map((asset) => asset.id) ?? [],
      )
    ).filter((asset): asset is StoredAsset => Boolean(asset));
    await createLibraryBackup("manual", previous, { retainAssets: collisions });
    await restoreBackupAssets(backup);
    const { nodes, lectures, segments, markers, cards } = backup;
    libraryRepository
      .getState()
      .importLibrary({ nodes, lectures, segments, markers, cards });
  });
}
