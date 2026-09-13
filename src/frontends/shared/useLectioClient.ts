import { useSyncExternalStore } from "react";
import type {
  AppSettings,
  BackgroundJob,
  LectioClient,
  LibrarySnapshot,
  ReadableValue,
  SessionSnapshot,
} from "../../application/lectioClient";

function useReadable<T>(readable: ReadableValue<T>) {
  return useSyncExternalStore(
    readable.subscribe,
    readable.getSnapshot,
    readable.getSnapshot,
  );
}

export const useLibrary = (client: LectioClient): LibrarySnapshot =>
  useReadable(client.library);
export const useSession = (client: LectioClient): SessionSnapshot =>
  useReadable(client.session);
export const useSettings = (client: LectioClient): AppSettings =>
  useReadable(client.settings);
export const useJobs = (client: LectioClient): BackgroundJob[] =>
  useReadable(client.jobs);
