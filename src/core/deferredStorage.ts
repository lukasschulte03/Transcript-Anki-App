import type { PersistStorage, StorageValue } from "zustand/middleware";
import {
  finishStartupPhase,
  startStartupPhase,
} from "../services/startupMetrics";
import { db } from "./database";

const FIRST_PAINT_FALLBACK_MS = 250;
const WRITE_DEBOUNCE_MS = 150;
const MAX_WRITE_DELAY_MS = 2_000;

type PendingWrite<T> = { name: string; value: StorageValue<T> };

export type StateRepositoryStatus = {
  source: "dexie" | "local-storage" | "empty" | "recovered";
  migrated: boolean;
  fallbackUsed: boolean;
};

let repositoryStatus: StateRepositoryStatus = {
  source: "empty",
  migrated: false,
  fallbackUsed: false,
};

export const getStateRepositoryStatus = () => ({ ...repositoryStatus });

function parseStorageValue<T>(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StorageValue<T>;
  } catch {
    return null;
  }
}

async function mirrorState(name: string, serialized: string) {
  const existing = await db.libraryStates.get(name);
  if (existing?.serialized === serialized) return;
  await db.transaction(
    "rw",
    db.libraryStates,
    db.stateMigrationBackups,
    async () => {
      if (!existing) {
        await db.stateMigrationBackups.put({
          id: `${name}:legacy-local-storage`,
          storageKey: name,
          serialized,
          createdAt: new Date().toISOString(),
        });
      }
      await db.libraryStates.put({
        id: name,
        serialized,
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
      });
    },
  );
}

/**
 * Let the browser paint the static/React startup shell before reading and
 * parsing a potentially large library snapshot. The fallback also resolves
 * when WebView2 is hidden and requestAnimationFrame is throttled.
 */
function afterFirstPaint() {
  if (typeof window === "undefined") return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timeout = window.setTimeout(finish, FIRST_PAINT_FALLBACK_MS);
    window.requestAnimationFrame(() => {
      window.clearTimeout(timeout);
      window.setTimeout(finish, 0);
    });
  });
}

/**
 * Zustand's default localStorage adapter parses during module evaluation.
 * Keeping the same key and format preserves every existing library while this
 * adapter moves only the startup read beyond first paint.
 */
export function createDeferredLocalStorage<T>(): PersistStorage<T> {
  let pendingWrite: PendingWrite<T> | undefined;
  let writeTimer: number | undefined;
  let maximumWriteTimer: number | undefined;
  let lastSerialized = "";

  const flush = () => {
    if (writeTimer !== undefined) {
      window.clearTimeout(writeTimer);
      writeTimer = undefined;
    }
    if (maximumWriteTimer !== undefined) {
      window.clearTimeout(maximumWriteTimer);
      maximumWriteTimer = undefined;
    }
    const pending = pendingWrite;
    pendingWrite = undefined;
    if (!pending || typeof window === "undefined") return;
    const serialized = JSON.stringify(pending.value);
    if (serialized === lastSerialized) return;
    window.localStorage.setItem(pending.name, serialized);
    lastSerialized = serialized;
    // localStorage remains a crash-safe rollback copy while Dexie becomes the
    // repository source. A failed mirror never invalidates the proven copy.
    void mirrorState(pending.name, serialized).catch(() => {
      repositoryStatus = { ...repositoryStatus, fallbackUsed: true };
    });
  };

  if (typeof window !== "undefined") {
    // A burst of transcript/progress updates becomes one durable write. Flush
    // synchronously when the document is leaving so a normal app close still
    // persists the newest library snapshot.
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }

  return {
    async getItem(name) {
      startStartupPhase("library-storage-read");
      await afterFirstPaint();
      if (typeof window === "undefined") {
        finishStartupPhase("library-storage-read", "unavailable");
        return null;
      }
      let raw: string | null;
      try {
        raw = window.localStorage.getItem(name);
      } catch (error) {
        finishStartupPhase("library-storage-read", "storage-error");
        throw error;
      }
      const localValue = parseStorageValue<T>(raw);

      // Never make first interactive render wait for IndexedDB when the proven
      // local rollback snapshot is already valid. Migration/verification runs
      // in the background and is idempotent.
      if (localValue) {
        lastSerialized = raw!;
        repositoryStatus = {
          source: "local-storage",
          migrated: false,
          fallbackUsed: false,
        };
        void db.libraryStates
          .get(name)
          .then(async (repositoryRecord) => {
            const migrated = repositoryRecord?.serialized !== raw;
            if (migrated) await mirrorState(name, raw!);
            else if (repositoryRecord)
              await db.libraryStates.update(name, {
                verifiedAt: new Date().toISOString(),
              });
            repositoryStatus = {
              source: migrated ? "local-storage" : "dexie",
              migrated,
              fallbackUsed: false,
            };
          })
          .catch(() => {
            repositoryStatus = { ...repositoryStatus, fallbackUsed: true };
          });
        finishStartupPhase("library-storage-read", "ok");
        return localValue;
      }

      const repositoryRecord = await db.libraryStates.get(name).catch(() => undefined);
      const repositoryValue = parseStorageValue<T>(
        repositoryRecord?.serialized ?? null,
      );
      if (repositoryValue) {
        try {
          window.localStorage.setItem(name, repositoryRecord!.serialized);
          lastSerialized = repositoryRecord!.serialized;
        } catch {
          // Dexie remains sufficient when localStorage is full/unavailable.
        }
        repositoryStatus = {
          source: "recovered",
          migrated: false,
          fallbackUsed: true,
        };
        finishStartupPhase("library-storage-read", "recovered-dexie");
        return repositoryValue;
      }

      if (raw) {
        try {
          window.localStorage.setItem(`${name}-corrupt-backup`, raw);
        } catch {
          // A full storage quota must not turn recovery into another failure.
        }
        repositoryStatus = {
          source: "empty",
          migrated: false,
          fallbackUsed: true,
        };
        finishStartupPhase("library-storage-read", "recovered-corrupt");
        return null;
      }

      repositoryStatus = {
        source: "empty",
        migrated: false,
        fallbackUsed: false,
      };
      finishStartupPhase("library-storage-read", "empty");
      return null;
    },
    setItem(name, value) {
      if (typeof window === "undefined") return;
      pendingWrite = { name, value };
      if (writeTimer !== undefined) window.clearTimeout(writeTimer);
      writeTimer = window.setTimeout(flush, WRITE_DEBOUNCE_MS);
      // Progress can update more frequently than the debounce window for
      // hours. A maximum delay keeps genuine user edits crash-safe even while
      // a transcription is continuously reporting progress.
      maximumWriteTimer ??= window.setTimeout(flush, MAX_WRITE_DELAY_MS);
    },
    removeItem(name) {
      if (typeof window === "undefined") return;
      pendingWrite = undefined;
      if (writeTimer !== undefined) window.clearTimeout(writeTimer);
      writeTimer = undefined;
      if (maximumWriteTimer !== undefined)
        window.clearTimeout(maximumWriteTimer);
      maximumWriteTimer = undefined;
      lastSerialized = "";
      window.localStorage.removeItem(name);
      void db.libraryStates.delete(name).catch(() => undefined);
    },
  };
}
