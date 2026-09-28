import { create } from "zustand";
import type { AppNotification, BackgroundJob } from "../core/types";
import { DATA_PROFILE } from "../runtimeProfile";

const now = () => new Date().toISOString();
const dismissedStorageKey = `lectio-dismissed-job-ids-v1:${DATA_PROFILE}`;
const dismissedJobIds = new Set<string>(readDismissedJobIds());

function readDismissedJobIds() {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(dismissedStorageKey) ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string").slice(-500)
      : [];
  } catch {
    return [];
  }
}

function saveDismissedJobIds() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      dismissedStorageKey,
      JSON.stringify([...dismissedJobIds].slice(-500)),
    );
  } catch {
    // Hiding a notification must remain best-effort if local storage is full.
  }
}

export interface JobState {
  jobs: BackgroundJob[];
  notifications: AppNotification[];
  upsertJob: (
    job: Omit<BackgroundJob, "startedAt" | "updatedAt"> & {
      startedAt?: string;
    },
  ) => void;
  dismissJob: (id: string) => void;
  pushNotification: (
    notification: Omit<AppNotification, "id" | "createdAt"> & {
      id?: string;
    },
  ) => void;
  dismissNotification: (id: string) => void;
  clearJobs: () => void;
}

/** Transient native/process state. It is deliberately never persisted. */
export const useJobStore = create<JobState>()((set) => ({
  jobs: [],
  notifications: [],
  upsertJob: (job) =>
    set((state) => {
      if (dismissedJobIds.has(job.id)) {
        if (job.status === "active" || job.status === "queued") {
          dismissedJobIds.delete(job.id);
          saveDismissedJobIds();
        } else return state;
      }
      const existing = state.jobs.find((item) => item.id === job.id);
      const timestamp = now();
      const next = {
        ...existing,
        ...job,
        startedAt: existing?.startedAt ?? job.startedAt ?? timestamp,
        updatedAt: timestamp,
      } satisfies BackgroundJob;
      return {
        jobs: existing
          ? state.jobs.map((item) => (item.id === job.id ? next : item))
          : [...state.jobs, next].slice(-250),
      };
    }),
  dismissJob: (id) => {
    dismissedJobIds.add(id);
    if (dismissedJobIds.size > 500) {
      const oldest = dismissedJobIds.values().next().value as string | undefined;
      if (oldest) dismissedJobIds.delete(oldest);
    }
    saveDismissedJobIds();
    set((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) }));
  },
  pushNotification: (notification) =>
    set((state) => {
      const next = {
        ...notification,
        id: notification.id ?? crypto.randomUUID(),
        createdAt: now(),
      } satisfies AppNotification;
      return {
        notifications: [
          ...state.notifications.filter((item) => item.id !== next.id),
          next,
        ].slice(-100),
      };
    }),
  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((item) => item.id !== id),
    })),
  clearJobs: () => {
    dismissedJobIds.clear();
    saveDismissedJobIds();
    set({ jobs: [] });
  },
}));

export const jobCommands = {
  upsert: (job: Parameters<JobState["upsertJob"]>[0]) =>
    useJobStore.getState().upsertJob(job),
  dismiss: (id: string) => useJobStore.getState().dismissJob(id),
  notify: (notification: Parameters<JobState["pushNotification"]>[0]) =>
    useJobStore.getState().pushNotification(notification),
  clear: () => useJobStore.getState().clearJobs(),
};
