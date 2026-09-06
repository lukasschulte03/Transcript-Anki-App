import type { RecordingSession } from "../core/types";

/** A recording is recoverable only when IndexedDB still holds audio chunks. */
export function canRecoverRecording(
  session: Pick<RecordingSession, "status"> | undefined,
  chunkCount: number,
) {
  return Boolean(
    session &&
      ["recording", "paused", "interrupted"].includes(session.status) &&
      chunkCount > 0,
  );
}
