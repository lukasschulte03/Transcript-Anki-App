import { useCallback, useEffect, useRef, useState } from "react";
import type { LectioClient } from "../../../application/lectioClient";
import { lectureCopy as c } from "./lectureCopy";

export function useLectureRecording(
  client: LectioClient,
  lectureId: string,
  onBusy: (busy: boolean) => void,
  onError: (error: string) => void,
  deviceId = "",
  quality: "compact" | "balanced" | "high" = "balanced",
) {
  const [state, setState] = useState<
    "idle" | "starting" | "recording" | "paused" | "saving"
  >("idle");
  const [elapsed, setElapsed] = useState(0);
  const [pending, setPending] = useState<{ id: string; name: string }[]>([]);
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const duration = useRef(0);
  const resumedAt = useRef(0);
  const now = useCallback(
    () =>
      duration.current +
      (resumedAt.current ? (performance.now() - resumedAt.current) / 1000 : 0),
    [],
  );
  const refresh = useCallback(async () => {
    const result = await client.recordings.pending(lectureId);
    if (result.ok) setPending(result.value);
  }, [client, lectureId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (state !== "recording") return;
    const timer = setInterval(() => setElapsed(now()), 500);
    return () => clearInterval(timer);
  }, [state, now]);
  useEffect(() => {
    if (state === "idle") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);
  useEffect(
    () => () => {
      const active = recorder.current;
      if (active && active.state !== "inactive") active.stop();
      active?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const start = async () => {
    if (state !== "idle") return;
    setState("starting");
    onBusy(true);
    onError("");
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      const active = new MediaRecorder(stream, {
        audioBitsPerSecond: {
          compact: 48_000,
          balanced: 96_000,
          high: 160_000,
        }[quality],
      });
      const created = await client.recordings.start(lectureId, active.mimeType);
      if (!created.ok) throw new Error(created.error.message);
      let queue = Promise.resolve();
      let sequence = 0;
      let failed = false;
      duration.current = 0;
      resumedAt.current = performance.now();
      setElapsed(0);
      active.ondataavailable = (event) => {
        if (!event.data.size) return;
        const index = sequence++;
        const timestamp = now();
        queue = queue
          .then(async () => {
            const result = await client.recordings.append(
              created.value,
              index,
              event.data,
              timestamp,
            );
            if (!result.ok) {
              failed = true;
              onError(result.error.message);
              if (active.state !== "inactive") active.stop();
            }
          })
          .catch(() => {
            failed = true;
            onError(c.importFailed);
            if (active.state !== "inactive") active.stop();
          });
      };
      active.onstop = () => {
        const finalDuration = now();
        resumedAt.current = 0;
        duration.current = finalDuration;
        setState("saving");
        active.stream.getTracks().forEach((track) => track.stop());
        void queue.then(async () => {
          if (!failed) {
            const result = await client.recordings.finish(
              created.value,
              finalDuration,
            );
            if (!result.ok) onError(result.error.message);
          }
          await refresh();
          setState("idle");
          onBusy(false);
          recorder.current = undefined;
        });
      };
      active.onerror = () => {
        onError(c.micError);
        if (active.state !== "inactive") active.stop();
      };
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          if (active.state !== "inactive") active.stop();
        };
      });
      recorder.current = active;
      active.start(3000);
      setState("recording");
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      setState("idle");
      onBusy(false);
      onError(
        error instanceof Error && error.name !== "NotAllowedError"
          ? error.message
          : c.micError,
      );
    }
  };
  const togglePause = () => {
    const active = recorder.current;
    if (!active) return;
    if (active.state === "recording") {
      duration.current = now();
      resumedAt.current = 0;
      active.pause();
      setState("paused");
    } else if (active.state === "paused") {
      resumedAt.current = performance.now();
      active.resume();
      setState("recording");
    }
  };
  const recover = async (id: string) => {
    setState("saving");
    onBusy(true);
    const result = await client.recordings.finish(id);
    if (!result.ok) onError(result.error.message);
    await refresh();
    setState("idle");
    onBusy(false);
  };
  return {
    state,
    elapsed,
    pending,
    start,
    togglePause,
    recover,
    stop: () => recorder.current?.stop(),
  };
}
