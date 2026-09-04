import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CircleStop,
  FileAudio,
  Mic,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Sparkles,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../core/database";
import { useAppStore } from "../../core/store";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Input, Label, Select } from "../../components/ui/Form";
import { confirmStorageForImport, formatTime, uid } from "../../lib/utils";
import {
  buildTranscriptionPrompt,
  cloudApiTranscription,
} from "../../services/transcription";
import { toast } from "sonner";
import {
  downloadLocalModel,
  getLocalModelStatus,
  transcribeWithLocalWhisper,
} from "../../services/localStt";

export function AudioPanel({
  lectureId,
  onTime,
}: {
  lectureId: string;
  onTime: (seconds: number) => void;
}) {
  const lecture = useAppStore((s) => s.lectures[lectureId]);
  const updateLecture = useAppStore((s) => s.updateLecture);
  const addMarker = useAppStore((s) => s.addMarker);
  const settings = useAppStore((s) => s.settings);
  const nodes = useAppStore((s) => s.nodes);
  const setSegments = useAppStore((s) => s.setSegments);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const upsertJob = useAppStore((s) => s.upsertJob);
  const asset = useLiveQuery(
    () =>
      lecture?.audioAssetId ? db.assets.get(lecture.audioAssetId) : undefined,
    [lecture?.audioAssetId],
  );
  const recoverableSession = useLiveQuery(
    () =>
      db.recordingSessions
        .where("lectureId")
        .equals(lectureId)
        .sortBy("createdAt")
        .then((sessions) => sessions.at(-1)),
    [lectureId],
  );
  const audioUrl = useMemo(
    () => (asset ? URL.createObjectURL(asset.blob) : ""),
    [asset],
  );
  const transcriptionPrompt = useMemo(
    () =>
      buildTranscriptionPrompt(nodes, lectureId, settings.transcriptionPrompt),
    [nodes, lectureId, settings.transcriptionPrompt],
  );
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [transcribeOpen, setTranscribeOpen] = useState(false);
  const [transcribeMode, setTranscribeMode] = useState<"local" | "api">(
    "local",
  );
  const [localInstalled, setLocalInstalled] = useState<boolean | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [savingRecording, setSavingRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const recordingSessionId = useRef<string | null>(null);
  const chunkSequence = useRef(0);
  const chunkWriteQueue = useRef<Promise<unknown>>(Promise.resolve());
  const accumulatedMs = useRef(0);
  const resumedAt = useRef(0);
  const timer = useRef<number | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );
  useEffect(
    () => () => {
      const activeRecorder = recorder.current;
      if (activeRecorder && activeRecorder.state !== "inactive") {
        activeRecorder.requestData();
        activeRecorder.stop();
      }
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed]);
  useEffect(() => {
    // Start a newly selected asset from its beginning. A completed recording
    // already has an elapsed duration even when its WebM container does not.
    setPlaybackTime(0);
    setAudioDuration(lecture?.audioDuration ?? 0);
    setPlaying(false);
  }, [lecture?.audioAssetId]);
  useEffect(() => {
    const seek = (event: Event) => {
      const detail = (event as CustomEvent<{ lectureId: string; time: number }>)
        .detail;
      if (detail.lectureId === lectureId && audio.current) {
        audio.current.currentTime = detail.time;
        void audio.current.play();
      }
    };
    window.addEventListener("lectio:seek", seek);
    return () => window.removeEventListener("lectio:seek", seek);
  }, [lectureId]);
  useEffect(() => {
    if (!transcribeOpen || transcribeMode !== "local") return;
    void getLocalModelStatus(settings.localTranscriptionModel ?? "base")
      .then((status) => setLocalInstalled(status.installed))
      .catch(() => setLocalInstalled(false));
  }, [transcribeOpen, transcribeMode, settings.localTranscriptionModel]);
  const durationNow = () =>
    (accumulatedMs.current +
      (recorder.current?.state === "recording"
        ? Date.now() - resumedAt.current
        : 0)) /
    1000;

  const finalizeRecording = async (sessionId: string, measuredDuration?: number) => {
    const session = await db.recordingSessions.get(sessionId);
    if (!session) throw new Error("Inspelningssessionen kunde inte hittas");
    const savedChunks = await db.recordingChunks
      .where("sessionId")
      .equals(sessionId)
      .sortBy("sequence");
    if (!savedChunks.length)
      throw new Error("Inspelningen innehåller inga sparade ljudsegment");
    const blob = new Blob(
      savedChunks.map((chunk) => chunk.blob),
      { type: session.mimeType || "audio/webm" },
    );
    const assetId = uid();
    await db.transaction(
      "rw",
      db.assets,
      db.recordingSessions,
      db.recordingChunks,
      async () => {
        await db.assets.put({
          id: assetId,
          lectureId,
          kind: "audio",
          name: session.name,
          mimeType: blob.type,
          blob,
          createdAt: session.createdAt,
        });
        await db.recordingChunks.where("sessionId").equals(sessionId).delete();
        await db.recordingSessions.delete(sessionId);
      },
    );
    updateLecture(lectureId, {
      audioAssetId: assetId,
      audioName: session.name,
      audioDuration: Math.max(0, measuredDuration ?? session.duration ?? 0),
    });
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const mr = new MediaRecorder(stream);
      const sessionId = uid();
      const createdAt = new Date().toISOString();
      const name = `Inspelning ${new Date().toLocaleString("sv-SE")}.webm`;
      await db.recordingSessions.put({
        id: sessionId,
        lectureId,
        name,
        mimeType: mr.mimeType || "audio/webm",
        status: "recording",
        duration: 0,
        createdAt,
      });
      recordingSessionId.current = sessionId;
      chunkSequence.current = 0;
      chunkWriteQueue.current = Promise.resolve();
      mr.ondataavailable = (event) => {
        if (!event.data.size) return;
        const chunk = event.data;
        const sequence = chunkSequence.current++;
        chunkWriteQueue.current = chunkWriteQueue.current.then(() =>
          db.recordingChunks.put({
            id: `${sessionId}-${sequence}`,
            sessionId,
            sequence,
            blob: chunk,
          }),
        );
      };
      mr.onstop = async () => {
        setSavingRecording(true);
        try {
          await chunkWriteQueue.current;
          await finalizeRecording(sessionId, accumulatedMs.current / 1000);
          toast.success("Inspelningen sparades säkert");
        } catch (error) {
          toast.error(`Inspelningen kunde inte slutföras: ${String(error)}`);
        } finally {
          recordingSessionId.current = null;
          stream.getTracks().forEach((track) => track.stop());
          setSavingRecording(false);
        }
      };
      mr.start(1000);
      recorder.current = mr;
      accumulatedMs.current = 0;
      resumedAt.current = Date.now();
      setElapsed(0);
      setRecording(true);
      timer.current = window.setInterval(() => {
        const duration = durationNow();
        setElapsed(duration);
        if (recordingSessionId.current)
          void db.recordingSessions.update(recordingSessionId.current, {
            duration,
          });
      }, 1000);
    } catch (e) {
      toast.error(`Kunde inte starta mikrofonen: ${String(e)}`);
    }
  };
  const stop = () => {
    const currentRecorder = recorder.current;
    if (!currentRecorder) return;
    const duration = durationNow();
    accumulatedMs.current = duration * 1000;
    if (recordingSessionId.current)
      void db.recordingSessions.update(recordingSessionId.current, {
        status: "interrupted",
        duration,
      });
    currentRecorder.requestData();
    currentRecorder.stop();
    recorder.current = null;
    setRecording(false);
    setPaused(false);
    if (timer.current) clearInterval(timer.current);
  };
  const pause = () => {
    if (!recorder.current) return;
    if (paused) {
      recorder.current.resume();
      resumedAt.current = Date.now();
      if (recordingSessionId.current)
        void db.recordingSessions.update(recordingSessionId.current, {
          status: "recording",
        });
    } else {
      accumulatedMs.current += Date.now() - resumedAt.current;
      recorder.current.pause();
      if (recordingSessionId.current)
        void db.recordingSessions.update(recordingSessionId.current, {
          status: "paused",
          duration: accumulatedMs.current / 1000,
        });
    }
    setPaused(!paused);
  };
  const recoverRecording = async () => {
    if (!recoverableSession) return;
    setSavingRecording(true);
    try {
      await finalizeRecording(recoverableSession.id);
      toast.success("Den avbrutna inspelningen återställdes");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSavingRecording(false);
    }
  };
  const discardRecovery = async () => {
    if (!recoverableSession) return;
    await db.transaction(
      "rw",
      db.recordingSessions,
      db.recordingChunks,
      async () => {
        await db.recordingChunks
          .where("sessionId")
          .equals(recoverableSession.id)
          .delete();
        await db.recordingSessions.delete(recoverableSession.id);
      },
    );
    toast.success("Den avbrutna inspelningen togs bort");
  };
  const importAudio = async (file?: File) => {
    if (!file) return;
    if (!(await confirmStorageForImport(file, "ljudfilen"))) return;
    const id = uid();
    await db.assets.put({
      id,
      lectureId,
      kind: "audio",
      name: file.name,
      mimeType: file.type || "audio/mpeg",
      blob: file,
      createdAt: new Date().toISOString(),
    });
    updateLecture(lectureId, {
      audioAssetId: id,
      audioName: file.name,
      // The browser will populate this when metadata is available. Do not
      // retain the duration belonging to the file this import replaces.
      audioDuration: undefined,
    });
    toast.success("Ljudfil importerad");
  };
  const transcribe = async () => {
    if (!asset || (transcribeMode === "api" && !apiKey)) return;
    const jobId = `transcription:${uid()}`;
    upsertJob({
      id: jobId,
      kind: "transcription",
      label:
        transcribeMode === "local"
          ? "Lokal transkribering"
          : "API-transkribering",
      phase: "preparing",
      status: "active",
      current: 0,
      detail:
        transcribeMode === "local"
          ? "Förbereder ljudfilen…"
          : "Skickar ljudfilen till vald tjänst…",
    });
    setBusy(true);
    try {
      const result =
        transcribeMode === "local"
          ? await transcribeWithLocalWhisper(
              asset.blob,
              settings.localTranscriptionModel ?? "base",
              settings.localTranscriptionAcceleration ?? "auto",
              jobId,
              transcriptionPrompt,
            )
          : await cloudApiTranscription.transcribe(
              asset.blob,
              settings,
              apiKey,
              transcriptionPrompt,
            );
      setSegments(lectureId, result.segments);
      upsertJob({
        id: jobId,
        kind: "transcription",
        label:
          transcribeMode === "local"
            ? "Lokal transkribering"
            : "API-transkribering",
        phase: "complete",
        status: "complete",
        current: 0,
        detail: `${result.segments.length} segment är klara.`,
      });
      setTranscribeOpen(false);
      setApiKey("");
      toast.success(`${result.segments.length} segment transkriberades`);
    } catch (e) {
      upsertJob({
        id: jobId,
        kind: "transcription",
        label:
          transcribeMode === "local"
            ? "Lokal transkribering"
            : "API-transkribering",
        phase: "error",
        status: "error",
        current: 0,
        detail: "Transkriberingen kunde inte slutföras.",
      });
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };
  const downloadModel = async () => {
    setDownloading(true);
    try {
      await downloadLocalModel(settings.localTranscriptionModel ?? "base");
      setLocalInstalled(true);
      toast.success("Whisper-modellen är installerad");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setDownloading(false);
    }
  };
  const knownDuration =
    Number.isFinite(audioDuration) && audioDuration > 0
      ? audioDuration
      : lecture?.audioDuration ?? 0;
  const current = audioUrl ? playbackTime : elapsed;
  const registerDuration = useCallback(
    (element: HTMLAudioElement) => {
      const mediaDuration = element.duration;
      const seekableDuration = element.seekable.length
        ? element.seekable.end(element.seekable.length - 1)
        : 0;
      const duration = Number.isFinite(mediaDuration) && mediaDuration > 0
        ? mediaDuration
        : Number.isFinite(seekableDuration) && seekableDuration > 0
          ? seekableDuration
          : 0;
      if (!duration) return;
      setAudioDuration(duration);
      if (Math.abs((lecture?.audioDuration ?? 0) - duration) > 0.25) {
        updateLecture(lectureId, { audioDuration: duration });
      }
    },
    [lecture?.audioDuration, lectureId, updateLecture],
  );
  const skipAudio = useCallback((seconds: number) => {
    if (!audio.current) return;
    audio.current.currentTime = Math.max(
      0,
      Math.min(
        knownDuration || Infinity,
        audio.current.currentTime + seconds,
      ),
    );
  }, [knownDuration]);
  const togglePlayback = useCallback(() => {
    if (!audio.current) return;
    if (playing) audio.current.pause();
    else void audio.current.play();
  }, [playing]);
  const markMoment = useCallback(() => {
    addMarker({ lectureId, time: current, note: "" });
    toast.success(`Markerat ${formatTime(current)}`);
  }, [addMarker, lectureId, current]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        target?.closest("input, textarea, select, [contenteditable='true']")
      )
        return;
      if (event.code === "Space" && audioUrl) {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === "ArrowLeft" && audioUrl) {
        event.preventDefault();
        skipAudio(-10);
      } else if (event.key === "ArrowRight" && audioUrl) {
        event.preventDefault();
        skipAudio(10);
      } else if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        markMoment();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [audioUrl, togglePlayback, skipAudio, markMoment]);
  return (
    <div className="palette-top-shadow border-t border-slate-200/80 bg-white px-5 py-3">
      <div className="flex items-center gap-4">
        {recording ? (
          <>
            <Button variant="danger" size="icon" onClick={stop}>
              <CircleStop className="size-4" />
            </Button>
            <Button variant="secondary" size="icon" onClick={pause}>
              {paused ? (
                <Play className="size-4" />
              ) : (
                <Pause className="size-4" />
              )}
            </Button>
            <div className="flex min-w-28 items-center gap-2 font-mono text-sm font-semibold text-red-600">
              <span className="size-2 animate-pulse rounded-full bg-red-500" />
              {formatTime(elapsed)}
            </div>
          </>
        ) : (
          <Button size="sm" onClick={start} disabled={savingRecording}>
            <Mic className="size-4" /> Spela in
          </Button>
        )}
        {!recording && recoverableSession && !savingRecording && (
          <div className="flex items-center rounded-lg border border-amber-200 bg-amber-50 p-0.5">
            <Button variant="ghost" size="sm" onClick={recoverRecording}>
              <AlertTriangle className="size-4 text-amber-500" /> Återställ
              avbruten ({formatTime(recoverableSession.duration)})
            </Button>
            <button
              onClick={() =>
                confirm("Ta bort de sparade ljudsegmenten?") &&
                void discardRecovery()
              }
              className="grid size-7 place-items-center rounded-md text-amber-700 hover:bg-amber-100"
              title="Ta bort avbruten inspelning"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        )}
        {savingRecording && (
          <span className="text-xs font-medium text-slate-500">
            Sparar ljudsegment…
          </span>
        )}
        <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">
          <Upload className="size-3.5" /> Importera ljud
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => importAudio(e.target.files?.[0])}
          />
        </label>
        {audioUrl ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => skipAudio(-10)}
              title="Hoppa tillbaka 10 sekunder (vänsterpil)"
            >
              <RotateCcw className="size-3.5" /> −10 s
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={togglePlayback}
              title={playing ? "Pausa (mellanslag)" : "Spela (mellanslag)"}
            >
              {playing ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => skipAudio(10)}
              title="Hoppa fram 10 sekunder (högerpil)"
            >
              <RotateCw className="size-3.5" /> +10 s
            </Button>
            <audio
              ref={audio}
              src={audioUrl}
              className="hidden"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onLoadedMetadata={(event) => registerDuration(event.currentTarget)}
              onDurationChange={(event) => registerDuration(event.currentTarget)}
              onCanPlay={(event) => registerDuration(event.currentTarget)}
              onTimeUpdate={(e) => {
                setPlaybackTime(e.currentTarget.currentTime);
                onTime(e.currentTarget.currentTime);
              }}
            />
            <input
              type="range"
              min="0"
              max={knownDuration || 0}
              step="0.1"
              value={Math.min(playbackTime, knownDuration || playbackTime)}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (audio.current) audio.current.currentTime = value;
                setPlaybackTime(value);
              }}
              className="min-w-20 flex-1 accent-violet-600"
              aria-label="Ljudposition"
            />
            <span className="w-24 text-right font-mono text-[11px] tabular-nums text-slate-500">
              {formatTime(playbackTime)} / {knownDuration ? formatTime(knownDuration) : "--:--"}
            </span>
            <Select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="h-8 w-[72px] py-1 pl-2 pr-7 text-xs"
            >
              {[0.75, 1, 1.25, 1.5, 2].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setTranscribeOpen(true)}
            >
              <Sparkles className="size-3.5" /> Transkribera
            </Button>
          </div>
        ) : (
          <div className="flex flex-1 items-center gap-2 text-xs text-slate-400">
            <FileAudio className="size-4" /> Ingen ljudfil ännu
          </div>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={markMoment}
          title="Markera viktigt (M)"
        >
          <Star className="size-4 text-amber-500" /> Markera viktigt
        </Button>
      </div>
      <Dialog
        open={transcribeOpen}
        onOpenChange={setTranscribeOpen}
        title="Transkribera ljud"
        description="Välj lokal och kostnadsfri Whisper eller en egen API-provider."
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
            <button
              onClick={() => setTranscribeMode("local")}
              className={`rounded-lg px-3 py-2 text-xs font-semibold ${transcribeMode === "local" ? "bg-white text-violet-700 shadow-sm" : "text-slate-500"}`}
            >
              Lokalt · gratis
            </button>
            <button
              onClick={() => setTranscribeMode("api")}
              className={`rounded-lg px-3 py-2 text-xs font-semibold ${transcribeMode === "api" ? "bg-white text-violet-700 shadow-sm" : "text-slate-500"}`}
            >
              Eget API
            </button>
          </div>
          {transcribeMode === "local" ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs leading-5 text-emerald-800">
              <div className="font-semibold">
                Whisper {settings.localTranscriptionModel ?? "base"}
              </div>
              <div className="mt-1">
                Ljudet lämnar aldrig datorn. Motorn använder
                {settings.localTranscriptionAcceleration === "nvidia"
                  ? " NVIDIA-grafikkortet"
                  : settings.localTranscriptionAcceleration === "cpu"
                    ? " upp till åtta CPU-trådar"
                    : " NVIDIA när stödet är installerat, annars CPU"}
                .
              </div>
              {localInstalled === false && (
                <Button
                  className="mt-3"
                  size="sm"
                  onClick={downloadModel}
                  disabled={downloading}
                >
                  {downloading ? "Laddar ner…" : "Ladda ner modellen"}
                </Button>
              )}
              {localInstalled && (
                <div className="mt-2 font-semibold">
                  ✓ Modellen är installerad
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                Ljudet skickas till providern som valts under Inställningar.
                Nyckeln sparas inte.
              </div>
              <div>
                <Label>API-nyckel</Label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Klistra in för denna session"
                />
              </div>
              <div>
                <Label>Vald modell</Label>
                <Input value={settings.transcriptionModel} disabled />
              </div>
            </>
          )}
          {transcriptionPrompt && (
            <details className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-500">
              <summary className="cursor-pointer font-medium text-slate-700">
                Visa ordlista och ärvt context
              </summary>
              <p className="mt-2 whitespace-pre-wrap leading-5">
                {transcriptionPrompt}
              </p>
            </details>
          )}
          <Button
            className="w-full"
            disabled={
              busy || (transcribeMode === "local" ? !localInstalled : !apiKey)
            }
            onClick={transcribe}
          >
            {busy ? "Transkriberar…" : "Starta transkribering"}
          </Button>
          <button
            onClick={() => {
              setTranscribeOpen(false);
              setActiveView("settings");
            }}
            className="w-full text-center text-xs text-slate-400 hover:text-violet-600"
          >
            Hantera modeller och providers i Inställningar
          </button>
        </div>
      </Dialog>
    </div>
  );
}
