import test from "node:test";
import assert from "node:assert/strict";
import {
  parseLighthouseScores,
  parsePlaywrightMatrix,
  parseStabilityMetrics,
} from "./stability-report.mjs";

test("Playwright report extraction records pass, failure, skipped, and durations", () => {
  const report = parsePlaywrightMatrix(`
    ok  1 [chromium] › e2e\\core.spec.ts:1:1 › kärnflöde (1.2s)
    -   2 [chromium] › e2e\\next.spec.ts:1:1 › next-only (skipped)
    not ok 3 [chromium] › e2e\\bad.spec.ts:1:1 › regression (2.0s)
  `);
  assert.deepEqual(
    { passed: report.passed, failed: report.failed, skipped: report.skipped },
    { passed: 1, failed: 1, skipped: 1 },
  );
  assert.equal(report.tests[0].duration, "1.2s");
});

test("Lighthouse score extraction tolerates other console output", () => {
  assert.deepEqual(
    parseLighthouseScores("noise\nLighthouse: prestanda 85, tillgänglighet 100, praxis 100\n"),
    { performance: 85, accessibility: 100, bestPractices: 100 },
  );
  assert.equal(parseLighthouseScores("Lighthouse failed"), null);
});

test("stability metrics safely parse nested JSON with quoted braces", () => {
  const log = `[Lectio performance]\n{"text":"brace } in string","nested":{"count":2}}\n[Lectio soak report] {"cycles":7}`;
  assert.deepEqual(parseStabilityMetrics(log), {
    interaction: { text: "brace } in string", nested: { count: 2 } },
    soak: { cycles: 7 },
  });
  assert.deepEqual(parseStabilityMetrics("no metrics"), {
    interaction: null,
    soak: null,
  });
});
