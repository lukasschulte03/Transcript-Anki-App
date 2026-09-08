import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  CircleStop,
  FileAudio,
  FileDown,
  Gauge,
  Mic,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Sparkles,
  Star,
  Trash2,
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
import { toast } from "../../services/feedbackToast";
import {
  downloadLocalModel,
  getLocalEngineStatus,
  getLocalModelStatus,
  prepareAudioForCloudTranscription,
  optimizeAudioForStorage,
  transcribeWithLocalWhisper,
} from "../../services/localStt";
import type { LocalEngineStatus } from "../../services/localStt";
import {
  enqueueTranscription,
  isActiveTranscriptionCancelled,
} from "../../services/transcriptionQueue";
import { recommendLocalTranscription } from "../../services/transcriptionRecommendation";
import {
  estimateTranscriptionCost,
  formatTranscriptionCost,
} from "../../services/transcriptionCost";
import {
  deleteCredential,
  readCredential,
  writeCredential,
} from "../../services/credentials";
import { canRecoverRecording } from "../../services/recordingRecovery";
import { inheritedGlossary } from "../../services/glossary";
import {
  audioFingerprint,
  formatAudioBytes,
  audioMimeType,
  measureAudioDuration,
  sortAudioFiles,
  validateAudioFile,
} from "../../services/audioImport";

const playbackSpeeds = [0.75, 1, 1.25, 1.5, 2] as const;

type CachedApiChunk = {
  assetId: string;
  index: number;
  duration: number;
  segments: Awaited<
    ReturnType<typeof cloudApiTranscription.transcribe>
  >["segments"];
};

// Kept outside the component so the user can retry a failed API run from the
// dialog without re-uploading chunks that already succeeded.
const apiChunkCache = new Map<string, CachedApiChunk[]>();

export function AudioPanel({
  lectureId,
  onTime,
  mediaSuspended = false,
}: {
  lectureId: string;
  onTime: (seconds: number) => void;
  mediaSuspended?: boolean;
}) {
  const lecture = useAppStore((s) => s.lectures[lectureId]);
  const nodes = useAppStore((s) => s.nodes);
  const updateLecture = useAppStore((s) => s.updateLecture);
  const addMarker = useAppStore((s) => s.addMarker);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setSegments = useAppStore((s) => s.setSegments);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const upsertJob = useAppStore((s) => s.upsertJob);
  const audioParts = useMemo(() => {
    if (lecture?.audioParts?.length) return lecture.audioParts;
    return lecture?.audioAssetId
      ? [
          {
            assetId: lecture.audioAssetId,
            name: lecture.audioName ?? "Ljudinspelning",
            duration: lecture.audioDuration,
          },
        ]
      : [];
  }, [
    lecture?.audioAssetId,
    lecture?.audioDuration,
    lecture?.audioName,
    lecture?.audioParts,
  ]);
  const audioPartKey = audioParts.map((part) => part.assetId).join(":");
  const [activeAudioPart, setActiveAudioPart] = useState(0);
  // Keep just the playing part in renderer memory. Hydrating every split
  // mobile recording at once can exhaust WebView2 before transcription starts.
  const activeAudioAssetId = audioParts[activeAudioPart]?.assetId;
  const asset = useLiveQuery(
    () =>
      activeAudioAssetId
        ? db.assets.get(activeAudioAssetId)
        : undefined,
    [activeAudioAssetId],
  );
  const recoverableSession = useLiveQuery(async () => {
    const sessions = await db.recordingSessions
      .where("lectureId")
      .equals(lectureId)
      .sortBy("createdAt");
    const session = sessions.at(-1);
    if (!session) return undefined;
    const chunkCount = await db.recordingChunks
      .where("sessionId")
      .equals(session.id)
      .count();
    return canRecoverRecording(session, chunkCount) ? session : undefined;
  }, [lectureId]);
  const audioUrl = useMemo(
    () => (!mediaSuspended && asset ? URL.createObjectURL(asset.blob) : ""),
    [asset, mediaSuspended],
  );
  const transcriptionPrompt = useMemo(
    () =>
      buildTranscriptionPrompt(
        inheritedGlossary(
          nodes,
          lectureId,
          settings.transcriptionPrompt,
        ).terms.join(", "),
      ),
    [lectureId, nodes, settings.transcriptionPrompt],
  );
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const cycleSpeed = () => {
    setSpeed((currentSpeed) => {
      const currentIndex = playbackSpeeds.indexOf(
        currentSpeed as (typeof playbackSpeeds)[number],
      );
      return playbackSpeeds[(currentIndex + 1) % playbackSpeeds.length];
    });
  };
  const [transcribeOpen, setTranscribeOpen] = useState(false);
  const audioImportInput = useRef<HTMLInputElement>(null);
  const [transcribeMode, setTranscribeMode] = useState<"local" | "api">(
    "local",
  );
  const [localInstalled, setLocalInstalled] = useState<boolean | null>(null);
  const [localEngine, setLocalEngine] = useState<LocalEngineStatus | null>(
    null,
  );
  const [downloading, setDownloading] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [rememberApiKey, setRememberApiKey] = useState(true);
  const [savedApiKey, setSavedApiKey] = useState(false);
  const [savingRecording, setSavingRecording] = useState(false);
  const [optimizingAudio, setOptimizingAudio] = useState(false);
  const [optimizationResult, setOptimizationResult] = useState<{
    index: number;
    originalAssetId: string;
    originalName: string;
    originalBytes: number;
    optimized: Blob;
  } | null>(null);
  const [keepOriginalAfterOptimization, setKeepOriginalAfterOptimization] =
    useState(true);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState("");
  const [microphoneHealth, setMicrophoneHealth] = useState<
    "idle" | "checking" | "live" | "silent" | "error"
  >("idle");
  const recorder = useRef<MediaRecorder | null>(null);
  const transcriptionCredentialKey = `transcription:${settings.transcriptionProvider === "groq" ? "groq" : "openai"}`;
  const recordingSessionId = useRef<string | null>(null);
  const chunkSequence = useRef(0);
  const chunkWriteQueue = useRef<Promise<unknown>>(Promise.resolve());
  const accumulatedMs = useRef(0);
  const resumedAt = useRef(0);
  const timer = useRef<number | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const continuePlayback = useRef(false);
  const microphoneMonitor = useRef<number | null>(null);
  const microphoneContext = useRef<AudioContext | null>(null);
  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );
  const refreshMicrophones = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicrophones(devices.filter((device) => device.kind === "audioinput"));
    } catch {
      setMicrophones([]);
    }
  }, []);
  useEffect(() => {
    void refreshMicrophones();
    navigator.mediaDevices.addEventListener?.(
      "devicechange",
      refreshMicrophones,
    );
    return () =>
      navigator.mediaDevices.removeEventListener?.(
        "devicechange",
        refreshMicrophones,
      );
  }, [refreshMicrophones]);
  useEffect(() => {
    let cancelled = false;
    if (!transcribeOpen || transcribeMode !== "api") return;
    void readCredential(transcriptionCredentialKey)
      .then((secret) => {
        if (cancelled) return;
        setSavedApiKey(Boolean(secret));
        if (secret) setApiKey(secret);
      })
      .catch(() => {
        if (!cancelled) setSavedApiKey(false);
      });
    return () => {
      cancelled = true;
    };
  }, [transcribeOpen, transcribeMode, transcriptionCredentialKey]);
  useEffect(
    () => () => {
      const activeRecorder = recorder.current;
      if (activeRecorder && activeRecorder.state !== "inactive") {
        activeRecorder.requestData();
        activeRecorder.stop();
      }
      if (timer.current) clearInterval(timer.current);
      if (microphoneMonitor.current) clearInterval(microphoneMonitor.current);
      void microphoneContext.current?.close();
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
    setActiveAudioPart(0);
    setPlaying(false);
  }, [audioPartKey]);
  useEffect(() => {
    setPlaybackTime(0);
  }, [activeAudioPart, audioPartKey, audioParts]);
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
    const importAudioFromChecklist = (event: Event) => {
      if (
        (event as CustomEvent<{ lectureId?: string }>).detail?.lectureId ===
        lectureId
      )
        audioImportInput.current?.click();
    };
    const openTranscriptionFromChecklist = (event: Event) => {
      if (
        (event as CustomEvent<{ lectureId?: string }>).detail?.lectureId ===
        lectureId
      )
        setTranscribeOpen(true);
    };
    window.addEventListener("lectio:import-audio", importAudioFromChecklist);
    window.addEventListener(
      "lectio:open-transcription",
      openTranscriptionFromChecklist,
    );
    return () => {
      window.removeEventListener(
        "lectio:import-audio",
        importAudioFromChecklist,
      );
      window.removeEventListener(
        "lectio:open-transcription",
        openTranscriptionFromChecklist,
      );
    };
  }, [lectureId]);
  useEffect(() => {
    if (!transcribeOpen || transcribeMode !== "local") return;
    void Promise.all([
      getLocalModelStatus(settings.localTranscriptionModel ?? "base"),
      getLocalEngineStatus(),
    ])
      .then(([status, engine]) => {
        setLocalInstalled(status.installed);
        setLocalEngine(engine);
      })
      .catch(() => {
        setLocalInstalled(false);
        setLocalEngine(null);
      });
  }, [transcribeOpen, transcribeMode, settings.localTranscriptionModel]);
  const durationNow = () =>
    (accumulatedMs.current +
      (recorder.current?.state === "recording"
        ? Date.now() - resumedAt.current
        : 0)) /
    1000;
  const appendAudioPart = (
    assetId: string,
    name: string,
    duration?: number,
  ) => {
    const nextParts = [...audioParts, { assetId, name, duration }];
    updateLecture(lectureId, {
      // Keep the first part in the legacy fields so older exports remain
      // readable, while the ordered list is the source of truth going forward.
      audioAssetId: nextParts[0]?.assetId,
      audioName: nextParts[0]?.name,
      audioDuration: nextParts.reduce(
        (total, part) => total + (part.duration ?? 0),
        0,
      ),
      audioParts: nextParts,
    });
  };

  const stopMicrophoneMonitor = () => {
    if (microphoneMonitor.current)
      window.clearInterval(microphoneMonitor.current);
    microphoneMonitor.current = null;
    void microphoneContext.current?.close();
    microphoneContext.current = null;
  };
  const monitorMicrophone = (stream: MediaStream) => {
    stopMicrophoneMonitor();
    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor) return;
    const context = new AudioContextConstructor();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let lastSignalAt = Date.now();
    setMicrophoneHealth("checking");
    microphoneContext.current = context;
    microphoneMonitor.current = window.setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      const peak = samples.reduce(
        (max, sample) => Math.max(max, Math.abs(sample - 128)),
        0,
      );
      if (peak > 2) lastSignalAt = Date.now();
      setMicrophoneHealth(
        Date.now() - lastSignalAt > 12_000 ? "silent" : "live",
      );
    }, 2_000);
  };

  const finalizeRecording = async (
    sessionId: string,
    measuredDuration?: number,
  ) => {
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
    appendAudioPart(
      assetId,
      session.name,
      Math.max(0, measuredDuration ?? session.duration ?? 0),
    );
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          ...(selectedMicrophoneId
            ? { deviceId: { exact: selectedMicrophoneId } }
            : {}),
        },
      });
      void refreshMicrophones();
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
          stopMicrophoneMonitor();
          stream.getTracks().forEach((track) => track.stop());
          setSavingRecording(false);
        }
      };
      mr.onerror = () => {
        setMicrophoneHealth("error");
        if (recordingSessionId.current)
          void db.recordingSessions.update(recordingSessionId.current, {
            status: "interrupted",
            duration: durationNow(),
          });
        toast.error("Inspelningen avbröts. Sparade ljuddelar kan återställas.");
      };
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          if (mr.state === "inactive") return;
          setMicrophoneHealth("error");
          if (recordingSessionId.current)
            void db.recordingSessions.update(recordingSessionId.current, {
              status: "interrupted",
              duration: durationNow(),
            });
          mr.requestData();
          mr.stop();
          recorder.current = null;
          setRecording(false);
          setPaused(false);
          if (timer.current) clearInterval(timer.current);
          toast.error(
            "Mikrofonen kopplades från. Välj en mikrofon och starta igen; sparat ljud bevaras.",
          );
        };
      });
      mr.start(1000);
      monitorMicrophone(stream);
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
      setMicrophoneHealth("error");
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
    setMicrophoneHealth("idle");
    if (timer.current) clearInterval(timer.current);
  };
  const pause = () => {
    if (!recorder.current) return;
    if (paused) {
      recorder.current.resume();
      resumedAt.current = Date.now();
      setMicrophoneHealth("checking");
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
  const importAudio = async (files?: FileList | File[]) => {
    const incoming = files ? Array.from(files) : [];
    if (!incoming.length) return;
    const invalid = incoming.map(validateAudioFile).find(Boolean);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    for (const file of incoming) {
      if (!(await confirmStorageForImport(file, "ljudfilen"))) return;
    }
    const ordered = sortAudioFiles(incoming);
    const existingFingerprints = new Set(
      (await db.assets.where("lectureId").equals(lectureId).toArray())
        .map((asset) => asset.sourceFingerprint)
        .filter(Boolean),
    );
    const newParts: typeof audioParts = [];
    for (const file of ordered) {
      const sourceFingerprint = audioFingerprint(file);
      if (existingFingerprints.has(sourceFingerprint)) continue;
      const id = uid();
      const duration = await measureAudioDuration(file);
      await db.assets.put({
        id,
        lectureId,
        kind: "audio",
        name: file.name,
        mimeType: audioMimeType(file),
        blob: file,
        sourceFingerprint,
        createdAt: new Date().toISOString(),
      });
      newParts.push({
        assetId: id,
        name: file.name,
        duration,
        sourceFingerprint,
      });
    }
    const nextParts = [...audioParts, ...newParts];
    updateLecture(lectureId, {
      audioAssetId: nextParts[0]?.assetId,
      audioName: nextParts[0]?.name,
      audioDuration: nextParts.reduce(
        (total, part) => total + (part.duration ?? 0),
        0,
      ),
      audioParts: nextParts,
    });
    toast.success(
      newParts.length === 0
        ? "Ljudfilen finns redan i föreläsningen"
        : newParts.length === 1
          ? "Ljudfil importerad"
          : `${newParts.length} ljuddelar importerades i filnamnsordning`,
    );
  };
  const transcribe = async () => {
    if (!audioParts.length || (transcribeMode === "api" && !apiKey)) return;
    const selectedMode = transcribeMode;
    const selectedApiKey = apiKey;
    if (selectedMode === "api") {
      if (rememberApiKey) {
        await writeCredential(transcriptionCredentialKey, selectedApiKey);
        setSavedApiKey(true);
      } else if (savedApiKey) {
        await deleteCredential(transcriptionCredentialKey);
        setSavedApiKey(false);
      }
    }
    const jobId = `transcription:${uid()}`;
    upsertJob({
      id: jobId,
      kind: "transcription",
      label:
        selectedMode === "local"
          ? "Lokal transkribering"
          : "API-transkribering",
      phase: "queued",
      status: "queued",
      current: 0,
      detail: "Väntar på ledig transkriberingsmotor…",
    });
    setTranscribeOpen(false);
    setApiKey("");
    enqueueTranscription({
      id: jobId,
      run: async () => {
        const transcribeMode = selectedMode;
        const apiKey = selectedApiKey;
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
        try {
          let offset = 0;
          const mergedSegments: Parameters<typeof setSegments>[1] = [];
          const updatedParts = [...audioParts];
          const apiResumeKey =
            transcribeMode === "api"
              ? `${lectureId}:${settings.transcriptionProvider}:${settings.transcriptionModel}:${audioPartKey}`
              : "";
          const cachedApiChunks = apiResumeKey
            ? [...(apiChunkCache.get(apiResumeKey) ?? [])]
            : [];
          for (const [index, part] of audioParts.entries()) {
            if (isActiveTranscriptionCancelled(jobId))
              throw new Error("TRANSCRIPTION_CANCELLED");
            const partAsset = await db.assets.get(part.assetId);
            if (!partAsset)
              throw new Error("En eller flera ljuddelar kunde inte hittas lokalt");
            upsertJob({
              id: jobId,
              kind: "transcription",
              label:
                transcribeMode === "local"
                  ? "Lokal transkribering"
                  : "API-transkribering",
              phase: "transcribing",
              status: "active",
              current: index,
              total: audioParts.length,
              detail: `Bearbetar ljuddel ${index + 1} av ${audioParts.length}…`,
            });
            let uploadParts =
              transcribeMode === "api"
                ? await prepareAudioForCloudTranscription(partAsset.blob)
                : [partAsset.blob];
            let uploadOffset = 0;
            for (const [uploadIndex, uploadPart] of uploadParts.entries()) {
              if (isActiveTranscriptionCancelled(jobId))
                throw new Error("TRANSCRIPTION_CANCELLED");
              const cachedChunk = cachedApiChunks.find(
                (chunk) =>
                  chunk.assetId === part.assetId &&
                  chunk.index === uploadIndex,
              );
              if (cachedChunk) {
                mergedSegments.push(
                  ...cachedChunk.segments.map((segment) => ({
                    ...segment,
                    start: segment.start + offset + uploadOffset,
                    end: segment.end + offset + uploadOffset,
                  })),
                );
                uploadOffset += cachedChunk.duration;
                continue;
              }
              upsertJob({
                id: jobId,
                kind: "transcription",
                label:
                  transcribeMode === "local"
                    ? "Lokal transkribering"
                    : "API-transkribering",
                phase: "transcribing",
                status: "active",
                current: index,
                total: audioParts.length,
                detail:
                  uploadParts.length > 1
                    ? `Transkriberar uppladdningsdel ${uploadIndex + 1} av ${uploadParts.length}…`
                    : `Bearbetar ljuddel ${index + 1} av ${audioParts.length}…`,
              });
              const result =
                transcribeMode === "local"
                  ? await transcribeWithLocalWhisper(
                      uploadPart,
                      settings.localTranscriptionModel ?? "base",
                      settings.localTranscriptionAcceleration ?? "auto",
                      jobId,
                      transcriptionPrompt,
                    )
                  : await cloudApiTranscription.transcribe(
                      uploadPart,
                      settings,
                      apiKey,
                      transcriptionPrompt,
                    );
              mergedSegments.push(
                ...result.segments.map((segment) => ({
                  ...segment,
                  start: segment.start + offset + uploadOffset,
                  end: segment.end + offset + uploadOffset,
                })),
              );
              const uploadDuration =
                (await measureAudioDuration(uploadPart)) ||
                Math.max(0, ...result.segments.map((segment) => segment.end));
              if (apiResumeKey) {
                const nextCache = [
                  ...(apiChunkCache.get(apiResumeKey) ?? []),
                  {
                    assetId: part.assetId,
                    index: uploadIndex,
                    duration: uploadDuration,
                    segments: result.segments,
                  },
                ];
                apiChunkCache.set(apiResumeKey, nextCache);
                cachedApiChunks.push(nextCache.at(-1)!);
              }
              uploadOffset += uploadDuration;
            }
            // Release temporary cloud chunks before loading the next part.
            uploadParts = [];
            const measuredDuration = part.duration ?? uploadOffset;
            const duration =
              measuredDuration ||
              (await measureAudioDuration(partAsset.blob));
            updatedParts[index] = { ...part, duration };
            offset += duration;
            await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
          }
          updateLecture(lectureId, {
            audioParts: updatedParts,
            audioDuration: offset,
          });
          setSegments(lectureId, mergedSegments);
          if (apiResumeKey) apiChunkCache.delete(apiResumeKey);
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
            detail: `${mergedSegments.length} segment är klara.`,
          });
          toast.success(`${mergedSegments.length} segment transkriberades`);
        } catch (e) {
          const cancelled = String(e).includes("TRANSCRIPTION_CANCELLED");
          upsertJob({
            id: jobId,
            kind: "transcription",
            label:
              transcribeMode === "local"
                ? "Lokal transkribering"
                : "API-transkribering",
            phase: cancelled ? "cancelled" : "error",
            status: cancelled ? "cancelled" : "error",
            current: 0,
            detail: cancelled
              ? "Transkriberingen avbröts."
              : transcribeMode === "api"
                ? "Försök igen för att fortsätta från redan klara API-delar."
                : "Transkriberingen kunde inte slutföras.",
          });
          if (cancelled) toast.message("Transkriberingen avbröts");
          else toast.error(String(e));
        }
      },
    });
    toast.success("Transkriberingen lades till i kön");
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
  const partOffset = audioParts
    .slice(0, activeAudioPart)
    .reduce((total, part) => total + (part.duration ?? 0), 0);
  const knownDuration = audioParts.reduce(
    (total, part) => total + (part.duration ?? 0),
    0,
  );
  const transcriptionRecommendation = useMemo(
    () =>
      recommendLocalTranscription({
        durationSeconds: knownDuration,
        engine: localEngine,
        benchmarks: settings.localTranscriptionBenchmarks,
      }),
    [knownDuration, localEngine, settings.localTranscriptionBenchmarks],
  );
  const transcriptionCostEstimate = useMemo(
    () =>
      settings.transcriptionProvider === "local"
        ? undefined
        : estimateTranscriptionCost(
            settings.transcriptionProvider,
            settings.transcriptionModel,
            knownDuration,
          ),
    [
      knownDuration,
      settings.transcriptionModel,
      settings.transcriptionProvider,
    ],
  );
  const formattedTranscriptionCost = transcriptionCostEstimate
    ? formatTranscriptionCost(transcriptionCostEstimate)
    : undefined;
  const current = audioUrl ? partOffset + playbackTime : elapsed;
  const registerDuration = useCallback(
    (element: HTMLAudioElement) => {
      const mediaDuration = element.duration;
      const seekableDuration = element.seekable.length
        ? element.seekable.end(element.seekable.length - 1)
        : 0;
      const duration =
        Number.isFinite(mediaDuration) && mediaDuration > 0
          ? mediaDuration
          : Number.isFinite(seekableDuration) && seekableDuration > 0
            ? seekableDuration
            : 0;
      if (!duration) return;
      const nextParts = audioParts.map((part, index) =>
        index === activeAudioPart ? { ...part, duration } : part,
      );
      const total = nextParts.reduce(
        (sum, part) => sum + (part.duration ?? 0),
        0,
      );
      if (Math.abs((lecture?.audioDuration ?? 0) - total) > 0.25)
        updateLecture(lectureId, {
          audioParts: nextParts,
          audioDuration: total,
        });
    },
    [
      activeAudioPart,
      audioParts,
      lecture?.audioDuration,
      lectureId,
      updateLecture,
    ],
  );
  const seekTo = useCallback(
    (requestedTime: number) => {
      if (!audio.current) return;
      const target = Math.max(
        0,
        Math.min(knownDuration || Infinity, requestedTime),
      );
      let offset = 0;
      const index = audioParts.findIndex((part) => {
        const end = offset + (part.duration ?? 0);
        if (target <= end || part === audioParts.at(-1)) return true;
        offset = end;
        return false;
      });
      const nextIndex = Math.max(0, index);
      const localTime = Math.max(0, target - offset);
      if (nextIndex === activeAudioPart) audio.current.currentTime = localTime;
      else {
        pendingSeek.current = localTime;
        continuePlayback.current = playing;
        setActiveAudioPart(nextIndex);
      }
    },
    [activeAudioPart, audioParts, knownDuration, playing],
  );
  const skipAudio = useCallback(
    (seconds: number) => seekTo(current + seconds),
    [current, seekTo],
  );
  const moveAudioPart = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= audioParts.length) return;
    const nextParts = [...audioParts];
    [nextParts[index], nextParts[nextIndex]] = [
      nextParts[nextIndex],
      nextParts[index],
    ];
    updateLecture(lectureId, { audioParts: nextParts });
    if (activeAudioPart === index) setActiveAudioPart(nextIndex);
    else if (activeAudioPart === nextIndex) setActiveAudioPart(index);
  };
  const deleteAudioPart = async (index: number) => {
    if (!audioParts.length) return;
    const part = audioParts[index];
    if (!part) return;
    const description =
      audioParts.length === 1
        ? `Ta bort ljudfilen ”${part.name}” från föreläsningen?`
        : `Ta bort ljuddelen ”${part.name}”?`;
    if (!window.confirm(description)) return;

    const nextParts = audioParts.filter((_, partIndex) => partIndex !== index);
    const nextActivePart =
      activeAudioPart > index
        ? activeAudioPart - 1
        : Math.min(activeAudioPart, nextParts.length - 1);

    if (index === activeAudioPart) {
      audio.current?.pause();
      setPlaybackTime(0);
      pendingSeek.current = 0;
    }

    updateLecture(lectureId, {
      audioAssetId: nextParts[0]?.assetId,
      audioName: nextParts[0]?.name,
      audioDuration: nextParts.reduce(
        (total, audioPart) => total + (audioPart.duration ?? 0),
        0,
      ),
      audioParts: nextParts,
    });
    setActiveAudioPart(nextActivePart);
    await db.assets.bulkDelete(
      [part.assetId, part.originalAssetId].filter(
        (assetId): assetId is string => Boolean(assetId),
      ),
    );
    toast.success(
      audioParts.length === 1 ? "Ljudfilen togs bort" : "Ljuddelen togs bort",
    );
  };
  const optimizeActiveAudio = async () => {
    const source = asset;
    const part = audioParts[activeAudioPart];
    if (!source || !part || optimizingAudio) return;
    const jobId = `audio-optimisation:${lectureId}:${part.assetId}`;
    setOptimizingAudio(true);
    upsertJob({
      id: jobId,
      kind: "library",
      label: "Optimerar ljud",
      phase: "encoding",
      status: "active",
      current: 0,
      total: 1,
      detail: "Konverterar i bakgrunden…",
    });
    try {
      const optimized = await optimizeAudioForStorage(source.blob);
      if (optimized.size >= source.blob.size) {
        upsertJob({
          id: jobId,
          kind: "library",
          label: "Optimerar ljud",
          phase: "complete",
          status: "complete",
          current: 1,
          total: 1,
          detail: "Originalet är redan lika litet eller mindre.",
        });
        toast.message("Originalet är redan lika litet eller mindre.");
        return;
      }
      setOptimizationResult({
        index: activeAudioPart,
        originalAssetId: source.id,
        originalName: part.name,
        originalBytes: source.blob.size,
        optimized,
      });
      setKeepOriginalAfterOptimization(true);
      upsertJob({
        id: jobId,
        kind: "library",
        label: "Optimerar ljud",
        phase: "ready",
        status: "complete",
        current: 1,
        total: 1,
        detail: "Optimerad kopia är klar för granskning.",
      });
    } catch (error) {
      upsertJob({
        id: jobId,
        kind: "library",
        label: "Optimerar ljud",
        phase: "error",
        status: "error",
        current: 0,
        total: 1,
        detail: String(error),
      });
      toast.error(`Ljudoptimering misslyckades: ${String(error)}`);
    } finally {
      setOptimizingAudio(false);
    }
  };
  const applyOptimization = async () => {
    if (!optimizationResult) return;
    const result = optimizationResult;
    const currentPart = audioParts[result.index];
    if (!currentPart || currentPart.assetId !== result.originalAssetId) {
      toast.error("Ljuddelen ändrades medan optimeringen kördes. Försök igen.");
      setOptimizationResult(null);
      return;
    }
    const extensionless = result.originalName.replace(/\.[^.]+$/, "");
    const assetId = uid();
    const optimizedName = `${extensionless} · optimerad.m4a`;
    const retainedOriginalId =
      currentPart.originalAssetId ?? result.originalAssetId;
    await db.assets.put({
      id: assetId,
      lectureId,
      kind: "audio",
      name: optimizedName,
      mimeType: "audio/mp4",
      blob: result.optimized,
      createdAt: new Date().toISOString(),
    });
    const nextParts = audioParts.map((part, index) =>
      index === result.index
        ? {
            ...part,
            assetId,
            name: optimizedName,
            originalAssetId: keepOriginalAfterOptimization
              ? retainedOriginalId
              : undefined,
          }
        : part,
    );
    updateLecture(lectureId, {
      audioAssetId: nextParts[0]?.assetId,
      audioName: nextParts[0]?.name,
      audioParts: nextParts,
    });
    const staleAssetIds = keepOriginalAfterOptimization
      ? currentPart.originalAssetId
        ? [result.originalAssetId]
        : []
      : [result.originalAssetId, currentPart.originalAssetId].filter(
          (assetId): assetId is string => Boolean(assetId),
        );
    if (staleAssetIds.length) await db.assets.bulkDelete(staleAssetIds);
    setOptimizationResult(null);
    toast.success(
      keepOriginalAfterOptimization
        ? "Optimerad ljudkopia används. Originalet behålls lokalt."
        : "Ljudet har optimerats och originalet togs bort.",
    );
  };
  const restoreOriginalAudio = async () => {
    const part = audioParts[activeAudioPart];
    if (!part?.originalAssetId) return;
    const original = await db.assets.get(part.originalAssetId);
    if (!original) {
      toast.error("Originalfilen kunde inte hittas lokalt.");
      return;
    }
    const nextParts = audioParts.map((item, index) =>
      index === activeAudioPart
        ? {
            ...item,
            assetId: original.id,
            name: original.name,
            originalAssetId: undefined,
          }
        : item,
    );
    updateLecture(lectureId, {
      audioAssetId: nextParts[0]?.assetId,
      audioName: nextParts[0]?.name,
      audioParts: nextParts,
    });
    await db.assets.delete(part.assetId);
    toast.success("Originalfilen återställdes.");
  };
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
    const markFromChecklist = (event: Event) => {
      if (
        (event as CustomEvent<{ lectureId?: string }>).detail?.lectureId ===
        lectureId
      )
        markMoment();
    };
    window.addEventListener("lectio:mark-moment", markFromChecklist);
    return () =>
      window.removeEventListener("lectio:mark-moment", markFromChecklist);
  }, [lectureId, markMoment]);
  const handleKeyboardShortcut = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    const editingControl = target?.closest(
      "textarea, select, [contenteditable='true'], input:not([type='range'])",
    );
    if (
      document.querySelector("[role='dialog']") ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      editingControl
    )
      return;
    if (event.code === "Space" && audioUrl) {
      event.preventDefault();
      togglePlayback();
    } else if (event.key === "ArrowLeft" && audioUrl) {
      event.preventDefault();
      skipAudio(event.shiftKey ? -30 : -10);
    } else if (event.key === "ArrowRight" && audioUrl) {
      event.preventDefault();
      skipAudio(event.shiftKey ? 30 : 10);
    } else if (event.key.toLowerCase() === "m") {
      event.preventDefault();
      markMoment();
    } else if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      if (recording) stop();
      else void start();
    } else if (event.key.toLowerCase() === "p" && recording) {
      event.preventDefault();
      pause();
    } else if (event.shiftKey && event.key.toLowerCase() === "i") {
      event.preventDefault();
      audioImportInput.current?.click();
    } else if (event.shiftKey && event.key.toLowerCase() === "t" && audioUrl) {
      event.preventDefault();
      setTranscribeOpen(true);
    }
  });
  useEffect(() => {
    window.addEventListener("keydown", handleKeyboardShortcut);
    return () => window.removeEventListener("keydown", handleKeyboardShortcut);
  }, []);
  return (
    <div className="palette-top-shadow border-t border-slate-200/80 bg-white px-6 py-3">
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
        {!recording && microphones.length > 1 && (
          <Select
            value={selectedMicrophoneId}
            onChange={(event) => setSelectedMicrophoneId(event.target.value)}
            className="h-8 max-w-48 py-1 text-xs"
            aria-label="Mikrofon för nästa inspelning"
          >
            <option value="">Systemets standardmikrofon</option>
            {microphones.map((microphone, index) => (
              <option key={microphone.deviceId} value={microphone.deviceId}>
                {microphone.label || `Mikrofon ${index + 1}`}
              </option>
            ))}
          </Select>
        )}
        {recording && microphoneHealth !== "live" && (
          <span
            className={
              microphoneHealth === "error" || microphoneHealth === "silent"
                ? "text-xs font-medium text-[var(--palette-warning)]"
                : "text-xs text-[var(--palette-text-muted)]"
            }
            title={
              microphoneHealth === "silent"
                ? "Ingen ljudnivå upptäcktes nyligen. Kontrollera mikrofonen om föreläsaren talar."
                : "Kontrollerar att mikrofonen tar emot ljud."
            }
          >
            {microphoneHealth === "silent"
              ? "Kontrollera mikrofonen"
              : "Kontrollerar mikrofon…"}
          </span>
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
        <Button variant="outline" size="sm" asChild>
          <label className="cursor-pointer">
            <FileDown className="size-3.5" /> Importera ljud
            <input
              ref={audioImportInput}
              type="file"
              accept="audio/*,.m4a,.aac,.mp3,.wav,.mp4,.mpeg,.webm,.ogg,.opus,.flac"
              multiple
              className="hidden"
              onChange={(e) => void importAudio(e.target.files ?? undefined)}
            />
          </label>
        </Button>
        {mediaSuspended && audioParts.length > 0 ? (
          <span className="min-w-0 flex-1 text-xs text-[var(--palette-text-muted)]">
            Ljudspelaren pausas tillfälligt medan transkriberingen kör.
          </span>
        ) : audioUrl ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => skipAudio(-10)}
              title="Hoppa tillbaka 10 sekunder (vänsterpil)"
              aria-label="Hoppa tillbaka 10 sekunder"
            >
              <RotateCcw className="size-3.5" />
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
              size="icon-sm"
              onClick={() => skipAudio(10)}
              title="Hoppa fram 10 sekunder (högerpil)"
              aria-label="Hoppa fram 10 sekunder"
            >
              <RotateCw className="size-3.5" />
            </Button>
            <audio
              ref={audio}
              src={audioUrl}
              className="hidden"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => {
                if (activeAudioPart < audioParts.length - 1) {
                  pendingSeek.current = 0;
                  continuePlayback.current = true;
                  setActiveAudioPart((index) => index + 1);
                } else {
                  setPlaying(false);
                }
              }}
              onLoadedMetadata={(event) =>
                registerDuration(event.currentTarget)
              }
              onDurationChange={(event) =>
                registerDuration(event.currentTarget)
              }
              onCanPlay={(event) => {
                registerDuration(event.currentTarget);
                if (pendingSeek.current !== null) {
                  event.currentTarget.currentTime = pendingSeek.current;
                  pendingSeek.current = null;
                }
                if (continuePlayback.current) {
                  continuePlayback.current = false;
                  void event.currentTarget.play();
                }
              }}
              onTimeUpdate={(e) => {
                setPlaybackTime(e.currentTarget.currentTime);
                onTime(partOffset + e.currentTarget.currentTime);
              }}
            />
            <input
              type="range"
              min="0"
              max={knownDuration || 0}
              step="0.1"
              value={Math.min(current, knownDuration || current)}
              onChange={(event) => {
                const value = Number(event.target.value);
                seekTo(value);
              }}
              className="min-w-20 flex-1 accent-violet-600"
              aria-label="Ljudposition"
            />
            <span className="w-24 text-right font-mono text-xs tabular-nums text-slate-500">
              {formatTime(current)} /{" "}
              {knownDuration ? formatTime(knownDuration) : "--:--"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={cycleSpeed}
              title={`Uppspelningshastighet: ${speed}×. Klicka för nästa.`}
              aria-label={`Uppspelningshastighet ${speed} gånger. Klicka för nästa.`}
              className="gap-1 tabular-nums"
            >
              <Gauge className="size-3.5" /> {speed}×
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setTranscribeOpen(true)}
            >
              <Sparkles className="size-3.5" /> Transkribera
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void optimizeActiveAudio()}
              disabled={optimizingAudio}
              title="Optimera ljud för mindre lagring och synk"
              aria-label="Optimera ljud för mindre lagring och synk"
            >
              <Archive className="size-3.5" />
            </Button>
            {audioParts[activeAudioPart]?.originalAssetId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void restoreOriginalAudio()}
                title="Återställ den sparade originalfilen"
              >
                <RotateCcw className="size-3.5" /> Återställ original
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void deleteAudioPart(activeAudioPart)}
              title={
                audioParts.length === 1
                  ? "Ta bort ljudfil från föreläsningen"
                  : "Ta bort aktiv ljuddel"
              }
              aria-label={
                audioParts.length === 1
                  ? "Ta bort ljudfil från föreläsningen"
                  : "Ta bort aktiv ljuddel"
              }
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
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
      {audioParts.length > 1 && (
        <div className="mt-2 flex items-center gap-2 overflow-x-auto border-t border-slate-100 pt-2 text-xs">
          <span className="shrink-0 font-medium text-slate-500">
            {audioParts.length} ljuddelar
          </span>
          {audioParts.map((part, index) => (
            <div
              key={part.assetId}
              className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 ${index === activeAudioPart ? "border-violet-200 bg-violet-50 text-violet-800" : "border-slate-200 bg-white text-slate-600"}`}
            >
              <button
                type="button"
                onClick={() => {
                  pendingSeek.current = 0;
                  setActiveAudioPart(index);
                }}
                className="max-w-36 truncate text-left"
                title={part.name}
              >
                {index + 1}. {part.name}
              </button>
              <button
                type="button"
                onClick={() => moveAudioPart(index, -1)}
                disabled={index === 0}
                className="disabled:text-slate-300"
                title="Flytta tidigare"
                aria-label={`Flytta ${part.name} tidigare`}
              >
                <ArrowUp className="size-3" />
              </button>
              <button
                type="button"
                onClick={() => moveAudioPart(index, 1)}
                disabled={index === audioParts.length - 1}
                className="disabled:text-slate-300"
                title="Flytta senare"
                aria-label={`Flytta ${part.name} senare`}
              >
                <ArrowDown className="size-3" />
              </button>
              <button
                type="button"
                onClick={() => void deleteAudioPart(index)}
                className="text-[var(--destructive)] hover:text-[var(--destructive)]/80"
                title="Ta bort ljuddel"
                aria-label={`Ta bort ${part.name}`}
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <Dialog
        open={Boolean(optimizationResult)}
        onOpenChange={(open) => !open && setOptimizationResult(null)}
        title="Optimerad ljudkopia klar"
        description="Talet sparas som mono AAC med 64 kbit/s, anpassat för taligenkänning och mindre synk."
      >
        {optimizationResult && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
              <div className="font-medium">{optimizationResult.originalName}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatAudioBytes(optimizationResult.originalBytes)} →{" "}
                {formatAudioBytes(optimizationResult.optimized.size)} · sparar{" "}
                {formatAudioBytes(
                  optimizationResult.originalBytes -
                    optimizationResult.optimized.size,
                )}
              </p>
            </div>
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={keepOriginalAfterOptimization}
                onChange={(event) =>
                  setKeepOriginalAfterOptimization(event.target.checked)
                }
                className="mt-0.5"
              />
              <span>
                Behåll originalfilen lokalt
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Säkrast, men den fortsätter använda extra lagring och synk.
                </span>
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setOptimizationResult(null)}
              >
                Avbryt
              </Button>
              <Button
                variant={keepOriginalAfterOptimization ? "secondary" : "destructive"}
                onClick={() => void applyOptimization()}
              >
                {keepOriginalAfterOptimization
                  ? "Använd optimerad kopia"
                  : "Använd optimerad och radera original"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
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
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">
                      Rekommendation: {transcriptionRecommendation.model}
                    </div>
                    <p className="mt-1">{transcriptionRecommendation.reason}</p>
                  </div>
                  {(settings.localTranscriptionModel ?? "base") !==
                    transcriptionRecommendation.model && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        updateSettings({
                          localTranscriptionModel:
                            transcriptionRecommendation.model,
                        })
                      }
                    >
                      Välj förslag
                    </Button>
                  )}
                </div>
                <div className="mt-2 font-medium text-slate-600">
                  {transcriptionRecommendation.estimate} ·{" "}
                  {transcriptionRecommendation.resources}
                </div>
                <p className="mt-1 text-slate-500">
                  Tiden är en grov uppskattning och påverkas av ljud, dator och
                  andra program.
                </p>
                {transcriptionRecommendation.warning && (
                  <p className="mt-2 text-amber-700">
                    {transcriptionRecommendation.warning}
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs leading-5 text-emerald-800">
                <div className="font-semibold">
                  Ingen API-kostnad · Whisper{" "}
                  {settings.localTranscriptionModel ?? "base"}
                </div>
                <div className="mt-1">
                  Ljudet lämnar aldrig datorn. Motorn använder
                  {settings.localTranscriptionAcceleration === "nvidia"
                    ? " NVIDIA-grafikkortet"
                    : settings.localTranscriptionAcceleration === "cpu"
                      ? " CPU"
                      : " NVIDIA när stödet är installerat, annars CPU"}
                  .
                </div>
                {knownDuration > 0 && (
                  <div className="mt-1">
                    Ljudlängd: {formatTime(knownDuration)}
                  </div>
                )}
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
            </div>
          ) : (
            <>
              <div className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                Ljudet skickas till providern som valts under Inställningar.
                Nyckeln sparas bara om du väljer det nedan, i Windows Credential
                Manager.
              </div>
              <div className="rounded-lg border border-[var(--palette-border)] bg-[var(--palette-surface-muted)] p-3 text-xs leading-5 text-[var(--palette-text-muted)]">
                <div className="font-semibold text-[var(--palette-text)]">
                  Uppskattad API-kostnad
                </div>
                {knownDuration > 0 ? (
                  formattedTranscriptionCost ? (
                    <p className="mt-1">
                      Ljudlängd: {formatTime(knownDuration)} · ungefär{" "}
                      {formattedTranscriptionCost}. Beloppet är en uppskattning
                      och kan skilja från leverantörens fakturering.
                    </p>
                  ) : (
                    <p className="mt-1">
                      Ljudlängd: {formatTime(knownDuration)}. Lectio saknar
                      prisuppgift för {settings.transcriptionProvider} /{" "}
                      {settings.transcriptionModel}.
                    </p>
                  )
                ) : (
                  <p className="mt-1">
                    Ljudlängden fastställs när ljudfilens metadata har lästs.
                  </p>
                )}
              </div>
              <div>
                <Label>API-nyckel</Label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Sparad nyckel fylls i automatiskt"
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={rememberApiKey}
                    onChange={(event) =>
                      setRememberApiKey(event.target.checked)
                    }
                  />
                  Kom ihåg nyckeln säkert på den här datorn
                </label>
                {savedApiKey && (
                  <button
                    type="button"
                    className="font-medium text-violet-700 hover:text-violet-900"
                    onClick={async () => {
                      await deleteCredential(transcriptionCredentialKey);
                      setApiKey("");
                      setSavedApiKey(false);
                      toast.success("Den sparade API-nyckeln togs bort");
                    }}
                  >
                    Glöm sparad nyckel
                  </button>
                )}
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
            disabled={transcribeMode === "local" ? !localInstalled : !apiKey}
            onClick={transcribe}
          >
            Lägg till i transkriptionskön
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
