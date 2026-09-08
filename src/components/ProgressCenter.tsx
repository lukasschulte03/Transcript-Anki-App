import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Check, CircleX, Clock3, Download, LoaderCircle, X } from "lucide-react";
import { useEffect } from "react";
import { useAppStore } from "../core/store";
import type {
  BackgroundJob,
  BackgroundJobKind,
  BackgroundJobStatus,
} from "../core/types";
import { cancelDownload, cancelLocalTranscription } from "../services/localStt";
import { isTauri } from "../services/platform";
import { cancelActiveTranscription, cancelQueuedTranscription } from "../services/transcriptionQueue";
import { cancelActiveVision, cancelQueuedVision } from "../services/visualDescriptionQueue";

interface NativeProgressEvent {
  id: string;
  kind: BackgroundJobKind;
  label: string;
  phase: string;
  status: BackgroundJobStatus;
  current: number;
  total?: number;
  detail?: string;
}

const phaseLabel: Record<string, string> = {
  preparing: "Förbereder…",
  downloading: "Laddar ned…",
  extracting: "Installerar…",
  starting: "Startar Whisper…",
  queued: "Väntar i kö…",
  transcribing: "Transkriberar…",
  saving: "Sparar resultat…",
  syncing: "Synkar…",
  exporting: "Exporterar…",
  importing: "Importerar…",
  packing: "Packar arkiv…",
  complete: "Klar",
  error: "Misslyckades",
  cancelled: "Avbruten",
};

const bytes = (value: number) => {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(value >= 1024 * 1024 * 1024 ? 0 : 1)} MB`;
};

const time = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

function JobRow({ job }: { job: BackgroundJob }) {
  const dismissJob = useAppStore((state) => state.dismissJob);
  const upsertJob = useAppStore((state) => state.upsertJob);
  const percentage = job.total
    ? Math.min(100, Math.round((job.current / job.total) * 100))
    : null;
  const active = job.status === "active";
  const queued = job.status === "queued";
  const cancel = async () => {
    try {
      if (job.kind === "transcription" && queued) {
        if (cancelQueuedTranscription(job.id)) {
          upsertJob({ ...job, phase: "cancelled", status: "cancelled", detail: "Togs bort från kön." });
        }
      } else if (job.kind === "transcription" && active) {
        cancelActiveTranscription(job.id);
        await cancelLocalTranscription(job.id);
        upsertJob({ ...job, detail: "Avbryter transkriberingen…" });
      } else if (job.kind === "vision" && queued) {
        if (cancelQueuedVision(job.id)) {
          upsertJob({ ...job, phase: "cancelled", status: "cancelled", detail: "Togs bort från kön." });
        }
      } else if (job.kind === "vision" && active) {
        cancelActiveVision(job.id);
        upsertJob({ ...job, detail: "Avbryter lokal bildbeskrivning…" });
      } else if (job.kind === "download") {
        await cancelDownload(job.id);
      }
    } catch {
      // The native worker emits its own actionable error when applicable.
    }
  };
  const Icon = job.status === "error"
    ? CircleX
    : queued
    ? Clock3
    : active
    ? job.kind === "download"
      ? Download
      : LoaderCircle
    : Check;
  const detail =
    job.detail ??
    (job.kind === "transcription" && job.total
      ? `${time(job.current)} / ${time(job.total)}`
      : job.kind === "library" && job.total
      ? `${job.current} av ${job.total} objekt`
      : job.total
      ? `${bytes(job.current)} av ${bytes(job.total)}`
      : (phaseLabel[job.phase] ?? "Arbetar…"));

  return (
    <div className="w-80 rounded-xl border border-[var(--palette-border)] bg-[var(--palette-surface)]/95 p-3 shadow-lg backdrop-blur">
      <div className="flex items-start gap-2.5">
        <Icon
          className={`mt-0.5 size-4 shrink-0 ${job.status === "error" ? "text-[var(--palette-danger)]" : active && job.kind === "transcription" ? "animate-spin text-[var(--palette-accent)]" : "text-[var(--palette-text-muted)]"}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-[var(--palette-text)]">
              {job.label}
            </p>
            {percentage !== null && (
              <span className="ml-auto text-xs tabular-nums text-[var(--palette-text-muted)]">
                {percentage}%
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-[var(--palette-text-muted)]">{detail}</p>
        </div>
        {((job.kind === "transcription" || job.kind === "vision") && (queued || active)) || (active && job.kind === "download") ? (
          <button
            className="rounded p-1 text-[var(--palette-text-muted)] hover:bg-[var(--palette-surface-hover)] hover:text-[var(--palette-text)]"
            onClick={() => void cancel()}
            aria-label={queued ? "Ta bort från kön" : job.kind === "vision" ? "Avbryt bildbeskrivning" : job.kind === "transcription" ? "Avbryt transkribering" : "Avbryt nedladdning"}
            title={queued ? "Ta bort från kön" : job.kind === "vision" ? "Avbryt bildbeskrivning" : job.kind === "transcription" ? "Avbryt transkribering" : "Avbryt nedladdning"}
          >
            <X className="size-3.5" />
          </button>
        ) : null}
        {!active && !queued && (
          <button
            className="rounded p-1 text-[var(--palette-text-muted)] hover:bg-[var(--palette-surface-hover)] hover:text-[var(--palette-text)]"
            onClick={() => dismissJob(job.id)}
            aria-label="Stäng förlopp"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {(active || queued) && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[var(--palette-surface-muted)]">
          {percentage !== null ? (
            <div
              className="h-full rounded-full bg-[var(--palette-primary)] transition-[width] duration-300"
              style={{ width: `${percentage}%` }}
            />
          ) : (
            <div className="h-full w-2/5 animate-pulse rounded-full bg-[var(--palette-primary-muted)]" />
          )}
        </div>
      )}
    </div>
  );
}

export function ProgressCenter() {
  const jobs = useAppStore((state) => state.jobs);
  const upsertJob = useAppStore((state) => state.upsertJob);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: UnlistenFn | undefined;
    void listen<NativeProgressEvent>("lectio:progress", (event) => {
      upsertJob(event.payload);
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => unlisten?.();
  }, [upsertJob]);

  if (!jobs.length) return null;
  return (
    <aside className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-h-[calc(100vh-2rem)] flex-col gap-2 overflow-y-auto">
      {jobs.slice(-4).map((job) => (
        <div className="pointer-events-auto" key={job.id}>
          <JobRow job={job} />
        </div>
      ))}
    </aside>
  );
}
