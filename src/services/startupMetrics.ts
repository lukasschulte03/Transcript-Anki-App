/**
 * Small, local-only startup timeline. It deliberately records no library or
 * device content: the timings make slow-start reports actionable without
 * expanding the diagnostic privacy surface.
 */
const startedAt = typeof performance === "undefined" ? 0 : performance.now();
const timings: Array<{ stage: string; elapsedMs: number }> = [];
const recorded = new Set<string>();

export function markStartup(stage: string) {
  if (recorded.has(stage) || typeof performance === "undefined") return;
  recorded.add(stage);
  timings.push({
    stage,
    elapsedMs: Math.round(performance.now() - startedAt),
  });
}

export function startupTimings() {
  return timings.map((timing) => ({ ...timing }));
}
