import * as Sentry from "@sentry/react";
import { invoke } from "@tauri-apps/api/core";
import { downloadText } from "../lib/utils";
import { isTauri } from "./platform";

const MAX_EVENTS = 30;
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "0.4.0";

export type DiagnosticEvent = {
  at: string;
  area: string;
  message: string;
};

export type DiagnosticSnapshot = {
  generatedAt: string;
  app: { name: "Lectio"; version: string; desktop: boolean };
  device: Record<string, unknown>;
  events: DiagnosticEvent[];
};

const events: DiagnosticEvent[] = [];

// Do not allow a path, token, email address, or pasted content to leave the app.
export function redactDiagnosticText(value: unknown) {
  return String(value ?? "")
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/gi, "C:\\Users\\[redacted]")
    .replace(/(?:api[_ -]?key|token|authorization|bearer)[=: ]+[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .slice(0, 800);
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
  return {
    generatedAt: new Date().toISOString(),
    app: { name: "Lectio", version: APP_VERSION, desktop: isTauri() },
    device,
    events: [...events],
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
