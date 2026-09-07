import * as Sentry from "@sentry/react";
import { invoke } from "@tauri-apps/api/core";
import { downloadText } from "../lib/utils";
import { APP_VERSION } from "../lib/appVersion";
import { useAppStore } from "../core/store";
import { isTauri } from "./platform";

const MAX_EVENTS = 30;

export type DiagnosticEvent = {
  at: string;
  area: string;
  message: string;
};

type SafeJob = {
  kind: string;
  phase: string;
  status: string;
  current: number;
  total?: number;
  startedAt: string;
  updatedAt: string;
};

export type DiagnosticSnapshot = {
  generatedAt: string;
  app: { name: "Lectio"; version: string; desktop: boolean };
  device: Record<string, unknown>;
  events: DiagnosticEvent[];
  runtime: {
    transcriptionProvider: string;
    localModel: string;
    acceleration: string;
    aiMode: string;
    ankiConfigured: boolean;
    cloudConnected: boolean;
    recentJobs: SafeJob[];
  };
  suggestedActions: string[];
};

const events: DiagnosticEvent[] = [];

// Do not allow a path, token, email address, or pasted content to leave the app.
export function redactDiagnosticText(value: unknown) {
  return String(value ?? "")
    .replace(/[A-Za-z]:[\\/][^\r\n]*/g, "[redacted-path]")
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/gi, "C:\\Users\\[redacted]")
    .replace(/(?:api[_ -]?key|client[_ -]?secret|refresh[_ -]?token|access[_ -]?token|token|authorization|bearer|password|secret)["']?\s*[:=]\s*["']?[^\s,;}"']+/gi, "$1=[redacted]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .slice(0, 800);
}

export function diagnosticSuggestions(events: DiagnosticEvent[]) {
  const text = events.map((event) => event.message).join("\n").toLocaleLowerCase();
  const suggestions: string[] = [];
  if (/acl|open_url|not allowed/.test(text))
    suggestions.push("Installera den senaste Lectio-versionen och försök öppna länken igen.");
  if (/google.*(session|inloggning)|oauth|access_denied/.test(text))
    suggestions.push("Avbryt den aktuella Google-inloggningen och koppla kontot igen under Inställningar.");
  if (/whisper.*json|lokala talverktyg|ffmpeg/.test(text))
    suggestions.push("Kontrollera att ljudfilen och vald Whisper-modell finns kvar, och försök transkribera igen.");
  if (/anki/.test(text))
    suggestions.push("Öppna Anki och kontrollera AnkiConnect-adressen under Inställningar.");
  if (!suggestions.length)
    suggestions.push("Bifoga rapporten och beskriv stegen precis innan problemet uppstod.");
  return suggestions;
}

export function recordDiagnostic(area: string, error: unknown) {
  events.unshift({
    at: new Date().toISOString(),
    area: redactDiagnosticText(area),
    message: redactDiagnosticText(error instanceof Error ? error.message : error),
  });
  events.splice(MAX_EVENTS);
}

export function initializeDiagnostics() {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  if (!dsn) return false;
  Sentry.init({
    dsn,
    release: `lectio@${APP_VERSION}`,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? "production",
    sendDefaultPii: false,
    beforeSend(event) {
      // Sentry's browser SDK may include a URL; keep reports technical only.
      if (event.request) delete event.request;
      return event;
    },
  });
  return true;
}

export const reportingEnabled = () => Boolean(import.meta.env.VITE_SENTRY_DSN?.trim());

export async function createDiagnosticSnapshot(): Promise<DiagnosticSnapshot> {
  let device: Record<string, unknown> = {
    platform: navigator.platform,
    language: navigator.language,
    userAgent: redactDiagnosticText(navigator.userAgent),
  };
  if (isTauri()) {
    try {
      device = await invoke<Record<string, unknown>>("diagnostic_snapshot");
    } catch (error) {
      recordDiagnostic("diagnostics", error);
    }
  }
  const state = useAppStore.getState();
  const safeJobs: SafeJob[] = state.jobs.slice(-8).map((job) => ({
    kind: job.kind,
    phase: job.phase,
    status: job.status,
    current: job.current,
    total: job.total,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
  }));
  const snapshotEvents = [...events];
  return {
    generatedAt: new Date().toISOString(),
    app: { name: "Lectio", version: APP_VERSION, desktop: isTauri() },
    device,
    events: snapshotEvents,
    runtime: {
      transcriptionProvider: state.settings.transcriptionProvider,
      localModel: state.settings.localTranscriptionModel ?? "base",
      acceleration: state.settings.localTranscriptionAcceleration ?? "auto",
      aiMode: state.settings.aiMode,
      ankiConfigured: Boolean(state.settings.ankiUrl?.trim()),
      cloudConnected: Boolean(state.settings.cloudSync.connectedAt),
      recentJobs: safeJobs,
    },
    suggestedActions: diagnosticSuggestions(snapshotEvents),
  };
}

export async function exportDiagnosticSnapshot() {
  const snapshot = await createDiagnosticSnapshot();
  downloadText(
    `lectio-diagnostik-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(snapshot, null, 2),
  );
  return snapshot;
}

export async function sendFeedback(input: {
  category: "fel" | "förslag" | "annat";
  message: string;
  includeDiagnostics: boolean;
}) {
  const message = redactDiagnosticText(input.message);
  if (!message.trim()) throw new Error("Beskriv kort vad som hände först.");
  const snapshot = input.includeDiagnostics
    ? await createDiagnosticSnapshot()
    : undefined;
  if (!reportingEnabled()) return { delivered: false, snapshot };
  Sentry.withScope((scope) => {
    scope.setTag("feedback.category", input.category);
    scope.setContext("lectio_feedback", {
      message,
      diagnosticsIncluded: input.includeDiagnostics,
    });
    if (snapshot) scope.setContext("lectio_diagnostics", snapshot);
    Sentry.captureMessage(`Användarfeedback: ${message}`, "info");
  });
  return { delivered: true, snapshot };
}
