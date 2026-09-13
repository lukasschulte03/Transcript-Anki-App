/**
 * Small, local-only startup timeline. It deliberately records no library or
 * device content: the timings make slow-start reports actionable without
 * expanding the diagnostic privacy surface.
 */
export type StartupTiming = {
  stage: string;
  elapsedMs: number;
  durationMs?: number;
  result?: string;
};

declare global {
  interface Window {
    __LECTIO_BOOTSTRAP_AT__?: number;
  }
}

const startedAt =
  typeof performance === "undefined"
    ? 0
    : (typeof window !== "undefined"
        ? window.__LECTIO_BOOTSTRAP_AT__
        : undefined) ?? performance.now();
const timings: StartupTiming[] = [];
const recorded = new Set<string>();
const activePhases = new Map<string, number>();

export function markStartup(stage: string) {
  if (recorded.has(stage) || typeof performance === "undefined") return;
  recorded.add(stage);
  timings.push({
    stage,
    elapsedMs: Math.round(performance.now() - startedAt),
  });
}

export function startStartupPhase(stage: string) {
  if (typeof performance === "undefined" || activePhases.has(stage)) return;
  activePhases.set(stage, performance.now());
  markStartup(`${stage}:start`);
}

export function finishStartupPhase(stage: string, result = "ok") {
  if (typeof performance === "undefined") return;
  const phaseStartedAt = activePhases.get(stage);
  if (phaseStartedAt === undefined) return;
  activePhases.delete(stage);
  const finishedAt = performance.now();
  const key = `${stage}:complete`;
  if (recorded.has(key)) return;
  recorded.add(key);
  timings.push({
    stage: key,
    elapsedMs: Math.round(finishedAt - startedAt),
    durationMs: Math.round(finishedAt - phaseStartedAt),
    result,
  });
}

export function startupTimings() {
  return timings.map((timing) => ({ ...timing }));
}

export function startupElapsedMs() {
  if (typeof performance === "undefined") return 0;
  return Math.round(performance.now() - startedAt);
}
