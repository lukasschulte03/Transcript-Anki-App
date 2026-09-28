function parseJsonAfterMarker(log, marker) {
  const markerIndex = log.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = log.indexOf("{", markerIndex + marker.length);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < log.length; index += 1) {
    const character = log[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) {
      try {
        return JSON.parse(log.slice(start, index + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function parsePlaywrightMatrix(log) {
  const tests = [];
  const resultPattern = /^\s*(ok|not ok|-)\s+(\d+)\s+\[[^\]]+\]\s+›\s+(.+?)(?:\s+\(([^)]+)\))?\s*$/gm;
  for (const match of log.matchAll(resultPattern)) {
    const status = match[1] === "ok" ? "passed" : match[1] === "-" ? "skipped" : "failed";
    tests.push({
      status,
      title: match[3].trim(),
      duration: status === "skipped" ? null : (match[4] ?? null),
    });
  }
  return {
    passed: tests.filter((item) => item.status === "passed").length,
    failed: tests.filter((item) => item.status === "failed").length,
    skipped: tests.filter((item) => item.status === "skipped").length,
    tests,
  };
}

export function parseLighthouseScores(log) {
  const match = log.match(
    /Lighthouse:\s*prestanda\s+(\d+),\s*tillgänglighet\s+(\d+),\s*praxis\s+(\d+)/i,
  );
  return match
    ? {
        performance: Number(match[1]),
        accessibility: Number(match[2]),
        bestPractices: Number(match[3]),
      }
    : null;
}

export function parseStabilityMetrics(log) {
  return {
    interaction: parseJsonAfterMarker(log, "[Lectio performance]"),
    soak: parseJsonAfterMarker(log, "[Lectio soak report]"),
  };
}
