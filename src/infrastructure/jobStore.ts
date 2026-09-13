import { create } from "zustand";
import type { BackgroundJob } from "../core/types";

const now = () => new Date().toISOString();

export interface JobState {
  jobs: BackgroundJob[];
  upsertJob: (
    job: Omit<BackgroundJob, "startedAt" | "updatedAt"> & {
      startedAt?: string;
    },
  ) => void;
  dismissJob: (id: string) => void;
  clearJobs: () => void;
}

/** Transient native/process state. It is deliberately never persisted. */
export const useJobStore = create<JobState>()((set) => ({
  jobs: [],
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
          : [...state.jobs, next],
      };
    }),
  dismissJob: (id) =>
    set((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) })),
  clearJobs: () => set({ jobs: [] }),
}));

export const jobCommands = {
  upsert: (job: Parameters<JobState["upsertJob"]>[0]) =>
    useJobStore.getState().upsertJob(job),
  dismiss: (id: string) => useJobStore.getState().dismissJob(id),
  clear: () => useJobStore.getState().clearJobs(),
};
