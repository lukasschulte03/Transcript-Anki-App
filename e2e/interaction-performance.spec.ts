import type { Page, TestInfo } from "@playwright/test";
import { expect, seedLibrary, test } from "./qa-fixtures";

const stabilityMode = process.env.VITE_STABILITY_TEST === "true";

const budgets = {
  initialWorkspaceMs: 2_500,
  viewSwitchMs: 1_000,
  workspaceReturnMs: 1_500,
  backgroundJobBurstMs: 500,
  backgroundNavigationMs: 1_000,
  longestTaskMs: 250,
  mountedDomNodes: 5_000,
  persistentWritesPerJobBurst: 0,
} as const;

type BrowserMetrics = {
  longTasks: number[];
  stateWrites: Array<{ bytes: number; durationMs: number }>;
};

type PerformanceReport = {
  fixture: { transcriptSegments: number; persistedBytes: number };
  timingsMs: Record<string, number>;
  renderer: {
    domNodes: number;
    transcriptRows: number;
    longestTaskMs: number;
    longTaskCount: number;
  };
  persistence: {
    writesDuringJobBurst: number;
    bytesWrittenDuringJobBurst: number;
    writeTimeDuringJobBurstMs: number;
  };
  budgets: typeof budgets;
};

declare global {
  interface Window {
    __lectioQaPerformance?: BrowserMetrics;
  }
}

async function installPerformanceProbe(page: Page) {
  await page.addInitScript(() => {
    const metrics: BrowserMetrics = { longTasks: [], stateWrites: [] };
    window.__lectioQaPerformance = metrics;

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          metrics.longTasks.push(entry.duration);
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      // Chromium normally supports Long Tasks. Other engines still provide
      // navigation and persistence measurements.
    }

    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function instrumentedSetItem(key, value) {
      const startedAt = performance.now();
      const result = originalSetItem.call(this, key, value);
      if (key === "lectio-state-v1") {
        metrics.stateWrites.push({
          bytes: new Blob([value]).size,
          durationMs: performance.now() - startedAt,
        });
      }
      return result;
    };
  });
}

async function resetProbe(page: Page) {
  await page.evaluate(() => {
    if (!window.__lectioQaPerformance) return;
    window.__lectioQaPerformance.longTasks = [];
    window.__lectioQaPerformance.stateWrites = [];
  });
}

async function seedPerformanceLibrary(page: Page, segmentCount: number) {
  await seedLibrary(page);
  return page.evaluate((count) => {
    const key = "lectio-state-v1";
    const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
    const text =
      "Klinisk information med differentialdiagnostik, utredning och behandling för ett realistiskt långt transkript. ";
    stored.state.segments = Array.from({ length: count }, (_, index) => ({
      id: `performance-segment-${index}`,
      lectureId: "lecture",
      start: index * 5,
      end: index * 5 + 5,
      text: `${text}${index + 1}`,
    }));
    const serialized = JSON.stringify(stored);
    localStorage.setItem(key, serialized);
    return new Blob([serialized]).size;
  }, segmentCount);
}

async function measure(
  page: Page,
  action: () => Promise<unknown>,
  ready: () => Promise<unknown>,
) {
  const startedAt = await page.evaluate(() => performance.now());
  await action();
  await ready();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const finishedAt = await page.evaluate(() => performance.now());
  return Math.round((finishedAt - startedAt) * 10) / 10;
}

async function attachReport(testInfo: TestInfo, report: PerformanceReport) {
  const body = `${JSON.stringify(report, null, 2)}\n`;
  await testInfo.attach("interaction-performance.json", {
    body,
    contentType: "application/json",
  });
  console.log(`[Lectio performance]\n${body}`);
}

test("stort bibliotek håller sig responsivt under navigation och bakgrundsjobb", async ({
  page,
}, testInfo) => {
  test.skip(!stabilityMode, "Körs endast av qa:stability.");
  test.setTimeout(120_000);

  await installPerformanceProbe(page);
  await page.goto("/");
  const transcriptSegments = 5_000;
  const persistedBytes = await seedPerformanceLibrary(page, transcriptSegments);

  const timingsMs: Record<string, number> = {};
  const reloadStartedAt = Date.now();
  await page.reload();
  await page
    .locator('[data-segment="performance-segment-0"]')
    .waitFor({ state: "attached", timeout: 30_000 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  timingsMs.initialWorkspace = Date.now() - reloadStartedAt;
  const initialRenderer = await page.evaluate(() => ({
    domNodes: document.getElementsByTagName("*").length,
    transcriptRows: document.querySelectorAll("[data-segment]").length,
  }));
  const transcriptSearch = page.getByPlaceholder("Sök i transkript");
  await transcriptSearch.fill("5000");
  await expect(
    page.locator('[data-segment="performance-segment-4999"]'),
  ).toBeVisible();
  await transcriptSearch.fill("");
  await expect(
    page.locator('[data-segment="performance-segment-0"]'),
  ).toBeVisible();
  const destinations = [
    {
      name: "inbox",
      label: "Inkorg",
      ready: () =>
        page
          .getByText("Koppla din Google Drive-inkorg", { exact: true })
          .waitFor(),
    },
    {
      name: "superActions",
      label: "Super Actions",
      ready: () =>
        page.getByRole("heading", { name: "Super Actions" }).waitFor(),
    },
    {
      name: "dashboard",
      label: "Översikt",
      ready: () => page.getByRole("heading", { name: "Översikt" }).waitFor(),
    },
    {
      name: "settings",
      label: /^Inställningar/,
      ready: () =>
        page.getByRole("heading", { name: "Inställningar" }).waitFor(),
    },
  ] as const;

  for (const destination of destinations) {
    timingsMs[destination.name] = await measure(
      page,
      () => page.getByRole("button", { name: destination.label }).click(),
      destination.ready,
    );
  }

  timingsMs.workspaceReturn = await measure(
    page,
    () => page.getByRole("button", { name: "Akut buk", exact: true }).click(),
    () => page.locator('input[value="Akut buk"]').waitFor(),
  );

  // Let the preceding, genuine navigation edit flush before isolating the
  // progress burst. Transient job ticks themselves must write nothing.
  await page.waitForTimeout(250);
  await resetProbe(page);
  const burstStartedAt = await page.evaluate(() => performance.now());
  await page.evaluate(() => {
    for (let current = 1; current <= 30; current += 1) {
      window.dispatchEvent(
        new CustomEvent("lectio:stability-progress", {
          detail: {
            id: "performance-job",
            kind: "transcription",
            label: "Prestandatest",
            phase: "transcribing",
            status: "active",
            current,
            total: 30,
            detail: `${current} av 30 segment`,
          },
        }),
      );
    }
  });
  await expect(page.getByText("Prestandatest")).toBeVisible();
  timingsMs.backgroundJobBurst = Math.round(
    (await page.evaluate(() => performance.now())) - burstStartedAt,
  );
  timingsMs.backgroundNavigation = await measure(
    page,
    () => page.getByRole("button", { name: "Översikt", exact: true }).click(),
    () => page.getByRole("heading", { name: "Översikt" }).waitFor(),
  );

  const measured = await page.evaluate(() => {
    const metrics = window.__lectioQaPerformance ?? {
      longTasks: [],
      stateWrites: [],
    };
    return {
      longTasks: metrics.longTasks,
      stateWrites: metrics.stateWrites,
    };
  });
  const report: PerformanceReport = {
    fixture: { transcriptSegments, persistedBytes },
    timingsMs,
    renderer: {
      domNodes: initialRenderer.domNodes,
      transcriptRows: initialRenderer.transcriptRows,
      longestTaskMs: Math.round(Math.max(0, ...measured.longTasks)),
      longTaskCount: measured.longTasks.length,
    },
    persistence: {
      writesDuringJobBurst: measured.stateWrites.length,
      bytesWrittenDuringJobBurst: measured.stateWrites.reduce(
        (total, write) => total + write.bytes,
        0,
      ),
      writeTimeDuringJobBurstMs:
        Math.round(
          measured.stateWrites.reduce(
            (total, write) => total + write.durationMs,
            0,
          ) * 10,
        ) / 10,
    },
    budgets,
  };
  await attachReport(testInfo, report);

  expect
    .soft(report.timingsMs.initialWorkspace)
    .toBeLessThan(budgets.initialWorkspaceMs);
  for (const destination of [
    "inbox",
    "superActions",
    "dashboard",
    "settings",
  ]) {
    expect
      .soft(report.timingsMs[destination], `${destination} vybyte`)
      .toBeLessThan(budgets.viewSwitchMs);
  }
  expect
    .soft(report.timingsMs.workspaceReturn)
    .toBeLessThan(budgets.workspaceReturnMs);
  expect
    .soft(report.timingsMs.backgroundJobBurst)
    .toBeLessThan(budgets.backgroundJobBurstMs);
  expect
    .soft(report.timingsMs.backgroundNavigation)
    .toBeLessThan(budgets.backgroundNavigationMs);
  expect
    .soft(report.renderer.longestTaskMs)
    .toBeLessThan(budgets.longestTaskMs);
  expect.soft(report.renderer.domNodes).toBeLessThan(budgets.mountedDomNodes);
  expect
    .soft(report.persistence.writesDuringJobBurst)
    .toBeLessThanOrEqual(budgets.persistentWritesPerJobBurst);
});

test("samlade lagringsskrivningar bevarar den senaste biblioteksändringen", async ({
  page,
}) => {
  test.skip(!stabilityMode, "Körs endast av qa:stability.");
  await page.goto("/");
  await seedLibrary(page);
  await page.reload();

  const title = page.locator('input[value^="Akut buk"]');
  await title.fill("Akut buk – uppdaterad");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const persisted = JSON.parse(
          localStorage.getItem("lectio-state-v1") ?? "{}",
        );
        return persisted.state?.nodes?.find(
          (node: { id: string }) => node.id === "lecture",
        )?.title;
      }),
    )
    .toBe("Akut buk – uppdaterad");

  await title.fill("Akut buk – sista ändringen");
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide")),
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const persisted = JSON.parse(
          localStorage.getItem("lectio-state-v1") ?? "{}",
        );
        return persisted.state?.nodes?.find(
          (node: { id: string }) => node.id === "lecture",
        )?.title;
      }),
    )
    .toBe("Akut buk – sista ändringen");
});
