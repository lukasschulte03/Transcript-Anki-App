import { redactDiagnosticText } from "./diagnosticRedaction";

export type DiagnosticSubsystem = "app" | "transcription" | "vision" | "sync" | "native";
export type DiagnosticLogLevel = "info" | "warn" | "error";

export type DiagnosticLogEntry = {
  at: string;
  level: DiagnosticLogLevel;
  message: string;
  context?: string;
};

const LIMIT = 200;
const prefix = "lectio:diagnostic-log:";
const subsystems: DiagnosticSubsystem[] = ["app", "transcription", "vision", "sync", "native"];
const key = (subsystem: DiagnosticSubsystem) => `${prefix}${subsystem}`;

function read(subsystem: DiagnosticSubsystem): DiagnosticLogEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(subsystem)) ?? "[]");
    return Array.isArray(parsed) ? parsed.slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

function write(subsystem: DiagnosticSubsystem, entries: DiagnosticLogEntry[]) {
  try {
    localStorage.setItem(key(subsystem), JSON.stringify(entries.slice(0, LIMIT)));
  } catch {
    // Logging must never make a study workflow fail.
  }
}

/** Stores only a short, redacted technical trail — never lecture material. */
export function logDiagnostic(
  subsystem: DiagnosticSubsystem,
  message: unknown,
  options: { level?: DiagnosticLogLevel; context?: unknown } = {},
) {
  const entry: DiagnosticLogEntry = {
    at: new Date().toISOString(),
    level: options.level ?? "info",
    message: redactDiagnosticText(message),
    context: options.context ? redactDiagnosticText(options.context) : undefined,
  };
  write(subsystem, [entry, ...read(subsystem)]);
}

export function diagnosticLogs() {
  return Object.fromEntries(subsystems.map((subsystem) => [subsystem, read(subsystem)])) as
    Record<DiagnosticSubsystem, DiagnosticLogEntry[]>;
}
