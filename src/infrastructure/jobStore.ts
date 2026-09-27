import { create } from "zustand";
import type { AppNotification, BackgroundJob } from "../core/types";

const now = () => new Date().toISOString();

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
  dismissJob: (id) =>
    set((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) })),
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
  clearJobs: () => set({ jobs: [] }),
}));

export const jobCommands = {
  upsert: (job: Parameters<JobState["upsertJob"]>[0]) =>
    useJobStore.getState().upsertJob(job),
  dismiss: (id: string) => useJobStore.getState().dismissJob(id),
  notify: (notification: Parameters<JobState["pushNotification"]>[0]) =>
    useJobStore.getState().pushNotification(notification),
  clear: () => useJobStore.getState().clearJobs(),
};
