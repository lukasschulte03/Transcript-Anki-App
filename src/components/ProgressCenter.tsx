import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Check, Download, LoaderCircle, X } from "lucide-react";
import { useEffect } from "react";
import { useAppStore } from "../core/store";
import type {
  BackgroundJob,
  BackgroundJobKind,
  BackgroundJobStatus,
} from "../core/types";
import { cancelDownload } from "../services/localStt";
import { isTauri } from "../services/platform";

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
  transcribing: "Transkriberar…",
  saving: "Sparar resultat…",
  exporting: "Exporterar…",
  importing: "Importerar…",
  packing: "Packar arkiv…",
  complete: "Klar",
  error: "Misslyckades",
};

const bytes = (value: number) => {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(value >= 1024 * 1024 * 1024 ? 0 : 1)} MB`;
};

function JobRow({ job }: { job: BackgroundJob }) {
  const dismissJob = useAppStore((state) => state.dismissJob);
  const percentage = job.total
    ? Math.min(100, Math.round((job.current / job.total) * 100))
    : null;
  const active = job.status === "active";
  const cancel = async () => {
    try {
      await cancelDownload(job.id);
    } catch {
      // The native worker emits its own actionable error when applicable.
    }
  };
  const Icon = active
    ? job.kind === "download"
      ? Download
      : LoaderCircle
    : Check;
  const detail =
    job.detail ??
    (job.total
      ? `${bytes(job.current)} av ${bytes(job.total)}`
      : (phaseLabel[job.phase] ?? "Arbetar…"));

  return (
    <div className="w-80 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
      <div className="flex items-start gap-2.5">
        <Icon
          className={`mt-0.5 size-4 shrink-0 ${active && job.kind === "transcription" ? "animate-spin text-indigo-600" : "text-slate-500"}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-slate-800">
              {job.label}
            </p>
            {percentage !== null && (
              <span className="ml-auto text-xs tabular-nums text-slate-500">
                {percentage}%
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">{detail}</p>
        </div>
        {active && job.kind === "download" && (
          <button
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onClick={() => void cancel()}
            aria-label="Avbryt nedladdning"
            title="Avbryt nedladdning"
          >
            <X className="size-3.5" />
          </button>
        )}
        {!active && (
          <button
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onClick={() => dismissJob(job.id)}
            aria-label="Stäng förlopp"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {active && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
          {percentage !== null ? (
            <div
              className="h-full rounded-full bg-indigo-500 transition-[width] duration-300"
              style={{ width: `${percentage}%` }}
            />
          ) : (
            <div className="h-full w-2/5 animate-pulse rounded-full bg-indigo-400" />
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
