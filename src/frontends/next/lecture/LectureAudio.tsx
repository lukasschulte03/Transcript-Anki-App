import * as Menu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import {
  AudioLines,
  Download,
  Gauge,
  Mic,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Square,
  Volume2,
  VolumeX,
  LoaderCircle,
  Check,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  LectioClient,
  LectureData,
} from "../../../application/lectioClient";
import { useSettings } from "../../shared/useLectioClient";
import { NextButton, NextIconButton } from "../ui/NextPrimitives";
import { useLectureRecording } from "./useLectureRecording";
import { lectureCopy as c, formatTime } from "./lectureCopy";
import { isKeyboardShortcutBlocked } from "../keyboardShortcuts";

export function LectureAudio({
  client,
  lecture,
  busy,
  onPosition,
  seek,
  onImport,
  onMark,
  onBusy,
  onError,
}: {
  client: LectioClient;
  lecture: LectureData;
  busy: boolean;
  onPosition(time: number): void;
  seek: { time: number; serial: number };
  onImport(): void;
  onMark(): void;
  onBusy(value: boolean): void;
  onError(value: string): void;
}) {
  const settings = useSettings(client);
  const parts = useMemo(
    () =>
      lecture.audioParts?.length
        ? lecture.audioParts
        : lecture.audioAssetId
          ? [
              {
                assetId: lecture.audioAssetId,
                name: lecture.audioName ?? "Ljud",
                duration: lecture.audioDuration,
              },
            ]
          : [],
    [
      lecture.audioParts,
      lecture.audioAssetId,
      lecture.audioName,
      lecture.audioDuration,
    ],
  );
  const [partIndex, setPartIndex] = useState(0);
  const part = parts[Math.min(partIndex, Math.max(0, parts.length - 1))];
  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deletePart, setDeletePart] = useState<typeof part | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const continuePlayback = useRef(false);
  const lastSeek = useRef(0);
  const recording = useLectureRecording(
    client,
    lecture.lectureId,
    onBusy,
    onError,
    settings.recordingDeviceId,
    settings.recordingQuality,
  );
  const recordingBusy = recording.state !== "idle";
  const offset = parts
    .slice(0, partIndex)
    .reduce((sum, item) => sum + (item.duration ?? 0), 0);

  useEffect(() => {
    let disposed = false;
    let objectUrl = "";
    setUrl("");
    setTime(0);
    setPlaying(false);
    setDuration(part?.duration ?? 0);
    if (!part) return;
    setLoading(true);
    void client.assets.read(part.assetId).then((result) => {
      if (disposed) return;
      setLoading(false);
      if (!result.ok) {
        onError(result.error.message);
        return;
      }
      objectUrl = URL.createObjectURL(result.value);
      setUrl(objectUrl);
    });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [client, part, onError]);
  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed, url]);
  useEffect(() => {
    if (!seek.serial || seek.serial === lastSeek.current || !parts.length)
      return;
    lastSeek.current = seek.serial;
    let remaining = seek.time;
    let index = 0;
    while (
      index < parts.length - 1 &&
      parts[index].duration &&
      remaining >= parts[index].duration!
    ) {
      remaining -= parts[index].duration!;
      index++;
    }
    if (index === partIndex && audio.current?.readyState)
      audio.current.currentTime = remaining;
    else {
      pendingSeek.current = remaining;
      setPartIndex(index);
    }
  }, [seek, parts, partIndex]);
  useEffect(() => {
    if (recording.state === "recording" || recording.state === "paused")
      onPosition(
        parts.reduce((sum, item) => sum + (item.duration ?? 0), 0) +
          recording.elapsed,
      );
  }, [recording.state, recording.elapsed, parts, onPosition]);

  const toggle = () => {
    const player = audio.current;
    if (!player || !url || recordingBusy) return;
    if (player.paused) void player.play().catch(() => onError(c.audioError));
    else player.pause();
  };
  const skip = (seconds: number) => {
    if (audio.current)
      audio.current.currentTime = Math.max(
        0,
        Math.min(duration, audio.current.currentTime + seconds),
      );
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isKeyboardShortcutBlocked(event)
      ) return;

      const target = event.target;
      const buttonFocused =
        target instanceof Element && target.closest("button, [role='button'], [role='tab']");
      if (event.code === "Space") {
        // Preserve native Space activation for focused buttons; range sliders
        // still allow Space to control playback after seeking.
        if (buttonFocused || !url || recordingBusy) return;
        event.preventDefault();
        toggle();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (!url || recordingBusy) return;
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        skip(direction * (event.shiftKey ? 30 : 10));
      } else if (event.key.toLowerCase() === "m") {
        if (!parts.length && recording.state === "idle") return;
        event.preventDefault();
        onMark();
      } else if (event.key.toLowerCase() === "r") {
        if (recording.state === "idle") {
          event.preventDefault();
          void recording.start();
        } else if (recording.state === "recording" || recording.state === "paused") {
          event.preventDefault();
          recording.stop();
        }
      } else if (
        event.key.toLowerCase() === "p" &&
        (recording.state === "recording" || recording.state === "paused")
      ) {
        event.preventDefault();
        recording.togglePause();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  return (
    <div className="lecture-audio-area">
      {recording.pending.length > 0 && (
        <div className="lecture-recovery" role="status">
          <span>{c.pending}</span>
          {recording.pending.map((item) => (
            <NextButton
              className="lecture-action"
              key={item.id}
              disabled={busy}
              onClick={() => void recording.recover(item.id)}
              title={item.name}
            >
              {c.recover}
            </NextButton>
          ))}
        </div>
      )}
      <div className="lecture-audio" aria-label="Ljudspelare">
        {url && (
          <audio
            ref={audio}
            src={url}
            preload="metadata"
            muted={muted}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => onError(c.audioError)}
            onLoadedMetadata={(event) => {
              const player = event.currentTarget;
              if (Number.isFinite(player.duration))
                setDuration(player.duration);
              if (pendingSeek.current !== null) {
                player.currentTime = pendingSeek.current;
                pendingSeek.current = null;
              }
              player.playbackRate = speed;
              if (continuePlayback.current) {
                continuePlayback.current = false;
                void player.play().catch(() => onError(c.audioError));
              }
            }}
            onTimeUpdate={(event) => {
              setTime(event.currentTarget.currentTime);
              onPosition(offset + event.currentTarget.currentTime);
            }}
            onEnded={() => {
              if (partIndex < parts.length - 1) {
                continuePlayback.current = true;
                setPartIndex((index) => index + 1);
              } else setPlaying(false);
            }}
          />
        )}
        {recordingBusy ? (
          <>
            <span
              className={`lecture-recording-dot ${recording.state === "paused" ? "is-paused" : ""}`}
            />
            <div className="lecture-recording-label">
              <strong>
                {recording.state === "paused"
                  ? c.paused
                  : recording.state === "saving"
                    ? c.savePending
                    : recording.state === "starting"
                      ? "Startar mikrofon…"
                      : c.recording}
              </strong>
              <span>{formatTime(recording.elapsed)}</span>
            </div>
            <div className="lecture-audio-end">
              <NextIconButton
                className="lecture-icon"
                disabled={
                  recording.state === "saving" || recording.state === "starting"
                }
                aria-label={recording.state === "paused" ? c.play : c.pause}
                onClick={recording.togglePause}
              >
                {recording.state === "paused" ? <Play /> : <Pause />}
              </NextIconButton>
              <NextButton
                className="lecture-action"
                disabled={
                  recording.state === "saving" || recording.state === "starting"
                }
                onClick={recording.stop}
              >
                <Square />
                {c.stop}
              </NextButton>
            </div>
          </>
        ) : parts.length ? (
          <>
            <NextIconButton
              className="lecture-play"
              disabled={!url || loading}
              aria-label={playing ? c.pause : c.play}
              onClick={toggle}
            >
              {loading ? (
                <LoaderCircle className="lecture-spin" />
              ) : playing ? (
                <Pause />
              ) : (
                <Play />
              )}
            </NextIconButton>
            <div className="lecture-skip">
              <NextIconButton
                className="lecture-icon"
                title={c.back}
                aria-label={c.back}
                onClick={() => skip(-10)}
                disabled={!url}
              >
                <RotateCcw />
              </NextIconButton>
              <NextIconButton
                className="lecture-icon"
                title={c.forward}
                aria-label={c.forward}
                onClick={() => skip(10)}
                disabled={!url}
              >
                <RotateCw />
              </NextIconButton>
            </div>
            <div className="lecture-track">
              <div className="lecture-track-label">
                <Menu.Root>
                  <Menu.Trigger
                    className="lecture-track-name"
                    disabled={parts.length < 2}
                    title={part?.name}
                  >
                    <AudioLines />
                    <span>{part?.name}</span>
                    {parts.length > 1 && (
                      <small>
                        {partIndex + 1}/{parts.length}
                      </small>
                    )}
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Content
                      className="study-menu"
                      side="top"
                      sideOffset={12}
                    >
                      {parts.map((item, index) => (
                        <Menu.Item
                          className="study-menu-item"
                          key={item.assetId}
                          onSelect={() => {
                            pendingSeek.current = 0;
                            setPartIndex(index);
                          }}
                        >
                          {item.name}
                          {index === partIndex && <Check />}
                        </Menu.Item>
                      ))}
                    </Menu.Content>
                  </Menu.Portal>
                </Menu.Root>
                <span className="lecture-audio-time">
                  {formatTime(time)} <span>/ {formatTime(duration)}</span>
                </span>
              </div>
              <input
                type="range"
                name="lecture-timeline"
                className="lecture-timeline"
                aria-label={c.timeline}
                min={0}
                max={duration || 1}
                step={0.1}
                value={Math.min(time, duration)}
                disabled={!duration}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (audio.current) audio.current.currentTime = value;
                  setTime(value);
                }}
                style={
                  {
                    "--played": `${duration ? (time / duration) * 100 : 0}%`,
                  } as React.CSSProperties
                }
              />
            </div>
            <div className="lecture-audio-end">
              <Menu.Root>
                <Menu.Trigger className="lecture-rate" aria-label={c.speed}>
                  <Gauge />
                  <span>{speed}×</span>
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Content
                    className="study-menu"
                    side="top"
                    sideOffset={12}
                  >
                    {[0.75, 1, 1.25, 1.5, 1.75, 2].map((value) => (
                      <Menu.Item
                        className="study-menu-item"
                        key={value}
                        onSelect={() => setSpeed(value)}
                      >
                        {value}×{speed === value && <Check />}
                      </Menu.Item>
                    ))}
                  </Menu.Content>
                </Menu.Portal>
              </Menu.Root>
              <NextIconButton
                className="lecture-icon lecture-volume"
                aria-label={muted ? c.unmute : c.mute}
                onClick={() => setMuted((value) => !value)}
              >
                {muted ? <VolumeX /> : <Volume2 />}
              </NextIconButton>
              <NextIconButton
                className="lecture-icon"
                title={c.importAudio}
                aria-label={c.importAudio}
                onClick={onImport}
                disabled={busy}
              >
                <Download />
              </NextIconButton>
              <NextIconButton
                className="lecture-icon"
                title="Ta bort ljudfil"
                aria-label={`Ta bort ${part?.name ?? "ljudfil"}`}
                onClick={() => setDeletePart(part)}
                disabled={busy || !part}
              >
                <Trash2 />
              </NextIconButton>
              <NextIconButton
                className="lecture-icon"
                title={c.record}
                aria-label={c.record}
                disabled={busy}
                onClick={() => {
                  audio.current?.pause();
                  void recording.start();
                }}
              >
                <Mic />
              </NextIconButton>
            </div>
          </>
        ) : (
          <>
            <AudioLines className="lecture-audio-empty-icon" />
            <div className="lecture-audio-intro">
              <strong>{c.audioEmpty}</strong>
              <span>{c.audioHint}</span>
            </div>
            <div className="lecture-audio-end">
              <NextButton
                className="lecture-action"
                disabled={busy}
                onClick={onImport}
              >
                <Download />
                {c.importAudio}
              </NextButton>
              <NextButton
                className="lecture-action"
                disabled={busy}
                onClick={() => void recording.start()}
              >
                <Mic />
                {c.record}
              </NextButton>
            </div>
          </>
        )}
      </div>
      <Dialog.Root open={deletePart !== null} onOpenChange={(open) => !open && setDeletePart(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="lecture-dialog-overlay" />
          <Dialog.Content className="lecture-dialog lecture-confirm">
            <Dialog.Title>Ta bort ljudfilen?</Dialog.Title>
            <Dialog.Description>
              {deletePart?.name} tas bort permanent från föreläsningen. Transkriptet påverkas inte.
            </Dialog.Description>
            <div className="lecture-dialog-actions">
              <Dialog.Close className="lecture-action">Behåll</Dialog.Close>
              <button
                className="lecture-action lecture-danger-action"
                onClick={async () => {
                  if (!deletePart) return;
                  audio.current?.pause();
                  onBusy(true);
                  const result = await client.assets.removeAudio(lecture.lectureId, deletePart.assetId);
                  onBusy(false);
                  if (!result.ok) onError(result.error.message);
                  else setPartIndex((current) => Math.max(0, Math.min(current, parts.length - 2)));
                  setDeletePart(null);
                }}
              >
                <Trash2 /> Ta bort
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
