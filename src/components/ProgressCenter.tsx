import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleX,
  Clock3,
  Info,
  LoaderCircle,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AppNotification,
  BackgroundJob,
  LectioClient,
} from "../application/lectioClient";
import { useJobs, useNotifications } from "../frontends/shared/useLectioClient";
import "./progress-center.css";

const phaseLabel: Record<string, string> = {
  preparing: "Förbereder…",
  downloading: "Laddar ned…",
  extracting: "Installerar…",
  starting: "Startar…",
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

function jobDetail(job: BackgroundJob) {
  if (job.detail) return job.detail;
  if (job.kind === "transcription" && job.total) {
    const current = Math.floor(job.current / 1_000);
    const total = Math.floor(job.total / 1_000);
    return `${Math.floor(current / 60)}:${String(current % 60).padStart(2, "0")} / ${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }
  if (job.kind === "library" && job.total)
    return `${job.current} av ${job.total} objekt`;
  return phaseLabel[job.phase] ?? "Arbetar…";
}

function JobCard({
  job,
  client,
}: {
  job: BackgroundJob;
  client: LectioClient;
}) {
  const percentage =
    job.total && job.total > 0
      ? Math.min(100, Math.round((job.current / job.total) * 100))
      : null;
  const running = job.status === "active" || job.status === "queued";
  const canCancel =
    running &&
    (job.cancellable ??
      (job.kind === "transcription" ||
        job.kind === "anki" ||
        job.kind === "download" ||
        (job.kind === "vision" && !job.id.startsWith("tracked:")) ||
        (job.kind === "library" &&
          job.status === "queued" &&
          job.id.startsWith("visual-index"))));
  const Icon =
    job.status === "error"
      ? CircleX
      : job.status === "complete"
        ? Check
        : job.status === "cancelled"
          ? X
          : job.status === "queued"
            ? Clock3
            : LoaderCircle;

  return (
    <article
      className={`notification-card notification-job notification-${job.status}`}
      role={job.status === "error" ? "alert" : "status"}
      aria-label={`${job.label}: ${jobDetail(job)}`}
    >
      <Icon
        className={`notification-icon ${running && job.status === "active" ? "notification-spin" : ""}`}
        aria-hidden="true"
      />
      <div className="notification-copy">
        <strong>{job.label}</strong>
        <span>{jobDetail(job)}</span>
      </div>
      {percentage !== null && running && (
        <span className="notification-percent">{percentage}%</span>
      )}
      {canCancel ? (
        <button
          type="button"
          className="notification-icon-button"
          aria-label="Avbryt uppgift"
          title="Avbryt"
          onClick={() => void client.jobs.cancel(job.id)}
        >
          <X aria-hidden="true" />
        </button>
      ) : !running ? (
        <button
          type="button"
          className="notification-icon-button"
          aria-label="Stäng uppgift"
          title="Stäng"
          onClick={() => void client.jobs.dismiss(job.id)}
        >
          <X aria-hidden="true" />
        </button>
      ) : null}
      {running && (
        <div
          className="notification-progress"
          role="progressbar"
          aria-label={job.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentage ?? undefined}
        >
          <span
            className={
              percentage === null ? "notification-progress-indeterminate" : ""
            }
            style={
              percentage === null ? undefined : { width: `${percentage}%` }
            }
          />
        </div>
      )}
    </article>
  );
}

function MessageCard({
  id,
  level,
  title,
  detail,
  onDismiss,
}: {
  id: string;
  level: "info" | "success" | "warning" | "error";
  title: string;
  detail?: string;
  onDismiss: (id: string) => void;
}) {
  const Icon =
    level === "error"
      ? CircleX
      : level === "warning"
        ? AlertTriangle
        : level === "success"
          ? Check
          : Info;
  return (
    <article
      className={`notification-card notification-${level}`}
      role={level === "error" ? "alert" : "status"}
    >
      <Icon className="notification-icon" aria-hidden="true" />
      <div className="notification-copy">
        <strong>{title}</strong>
        {detail && <span>{detail}</span>}
      </div>
      <button
        type="button"
        className="notification-icon-button"
        aria-label="Stäng notis"
        onClick={() => onDismiss(id)}
      >
        <X aria-hidden="true" />
      </button>
      {level === "error" && (
        <button
          type="button"
          className="notification-report-button"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("lectio:report-problem", { detail: title }),
            )
          }
        >
          Rapportera
        </button>
      )}
    </article>
  );
}

export function ProgressCenter({
  client,
  bottomOffset = 20,
}: {
  client: LectioClient;
  /** Reserves space for a persistent player or footer. */
  bottomOffset?: number;
}) {
  const jobs = useJobs(client);
  const notifications = useNotifications(client);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const timers = useRef(new Map<string, number>());
  const expanded = hovered || pinned;

  useEffect(
    () =>
      client.events.subscribe((event) => {
        if (event.type !== "error") return;
        window.setTimeout(() => {
          const failedJobJustReported = client.jobs
            .getSnapshot()
            .some(
              (job) =>
                job.status === "error" &&
                Date.now() - Date.parse(job.updatedAt) < 500,
            );
          if (!failedJobJustReported)
            client.notifications.push({
              id: `error:${event.error.code}:${event.error.message}`,
              level: "error",
              title: event.error.message,
            });
        }, 0);
      }),
    [client],
  );

  useEffect(() => {
    const handleNotification = (event: Event) => {
      if (!(event instanceof CustomEvent) || !event.detail) return;
      const detail = event.detail as {
        id?: string;
        level?: AppNotification["level"];
        title?: string;
        detail?: string;
      };
      if (!detail.title || !detail.level) return;
      client.notifications.push({
        id: detail.id,
        level: detail.level,
        title: detail.title,
        detail: detail.detail,
      });
    };
    window.addEventListener("lectio:notification", handleNotification);
    return () =>
      window.removeEventListener("lectio:notification", handleNotification);
  }, [client]);

  useEffect(() => {
    const retainedTimers = new Set<string>();
    for (const job of jobs) {
      const key = `job:${job.id}`;
      if (job.status === "active" || job.status === "queued") {
        const timer = timers.current.get(key);
        if (timer) window.clearTimeout(timer);
        timers.current.delete(key);
        continue;
      }
      if (job.status !== "complete" && job.status !== "cancelled") continue;
      retainedTimers.add(key);
      if (timers.current.has(key)) continue;
      timers.current.set(
        key,
        window.setTimeout(
          () => {
            void client.jobs.dismiss(job.id);
            timers.current.delete(key);
          },
          job.status === "complete" ? 6_000 : 3_500,
        ),
      );
    }
    for (const notice of notifications) {
      const key = `notice:${notice.id}`;
      if (notice.level !== "success" && notice.level !== "info") {
        const timer = timers.current.get(key);
        if (timer) window.clearTimeout(timer);
        timers.current.delete(key);
        continue;
      }
      retainedTimers.add(key);
      if (timers.current.has(key)) continue;
      timers.current.set(
        key,
        window.setTimeout(() => {
          void client.notifications.dismiss(notice.id);
          timers.current.delete(key);
        }, 7_000),
      );
    }
    for (const [key, timer] of timers.current) {
      if (retainedTimers.has(key)) continue;
      window.clearTimeout(timer);
      timers.current.delete(key);
    }
  }, [client, jobs, notifications]);

  useEffect(
    () => () => {
      timers.current.forEach(window.clearTimeout);
      timers.current.clear();
    },
    [],
  );

  const activeJobs = jobs.filter(
    (job) =>
      job.status === "active" ||
      job.status === "queued" ||
      job.status === "error",
  );
  const recentJobs = jobs
    .filter((job) => job.status === "complete" || job.status === "cancelled")
    .slice(-3);
  const visibleJobs = useMemo(
    () => [...activeJobs, ...recentJobs],
    [activeJobs, recentJobs],
  );
  const pendingCount = visibleJobs.filter(
    (job) => job.status === "active" || job.status === "queued",
  ).length;
  const count = visibleJobs.length + notifications.length;
  if (!count) return null;

  return (
    <aside
      className="notification-center"
      data-expanded={expanded}
      data-count={Math.min(count, 5)}
      style={{ bottom: `max(16px, ${bottomOffset}px)` }}
      aria-label="Notiser och pågående uppgifter"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setHovered(false);
      }}
    >
      <div className="notification-list" aria-live="polite">
        {notifications.map((item) => (
          <MessageCard
            key={`notice:${item.id}`}
            {...item}
            onDismiss={(id) => void client.notifications.dismiss(id)}
          />
        ))}
        {visibleJobs.map((job) => (
          <JobCard key={`job:${job.id}`} job={job} client={client} />
        ))}
      </div>
      {count > 1 && (
        <button
          type="button"
          className="notification-stack-toggle"
          aria-expanded={expanded}
          onClick={() => setPinned((value) => !value)}
        >
          {pendingCount
            ? `${pendingCount} ${pendingCount === 1 ? "uppgift" : "uppgifter"} pågår eller väntar`
            : `${count} notiser`}
          <ChevronDown aria-hidden="true" />
        </button>
      )}
    </aside>
  );
}
