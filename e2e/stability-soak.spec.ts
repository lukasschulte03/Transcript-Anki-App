import { expect, seedLibrary, test } from "./qa-fixtures";
import type { Page } from "@playwright/test";

const stabilityMode = process.env.VITE_STABILITY_TEST === "true";
const requestedMinutes = Number(process.env.LECTIO_STABILITY_SOAK_MINUTES ?? 30);
const soakMinutes = Number.isFinite(requestedMinutes)
  ? Math.min(90, Math.max(1, requestedMinutes))
  : 30;

type HeapSnapshot = {
  usedMb: number;
  totalMb: number;
  limitMb: number;
} | null;

async function readHeap(page: Page): Promise<HeapSnapshot> {
  return page.evaluate(() => {
    const memory = (
      performance as Performance & {
        memory?: {
          usedJSHeapSize: number;
          totalJSHeapSize: number;
          jsHeapSizeLimit: number;
        };
      }
    ).memory;
    if (!memory) return null;
    const toMb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;
    return {
      usedMb: toMb(memory.usedJSHeapSize),
      totalMb: toMb(memory.totalJSHeapSize),
      limitMb: toMb(memory.jsHeapSizeLimit),
    };
  });
}

test("30–90 minuters UI-soak behåller navigering och renderer-heap stabila", async ({ page }) => {
  test.skip(!stabilityMode, "Körs endast av qa:stability.");
  test.setTimeout(soakMinutes * 60_000 + 120_000);
  await page.setViewportSize({ width: 1366, height: 820 });
  await page.goto("/");
  await seedLibrary(page);
  await page.reload();
  await expect(page.locator('input[value="Akut buk"]')).toBeVisible();

  const viewButtons = [
    {
      name: "Inkorg",
      ready: () =>
        page
          .getByText("Koppla din Google Drive-inkorg", { exact: true })
          .waitFor(),
    },
    { name: "Super Actions", ready: () => page.getByRole("heading", { name: "Super Actions" }).waitFor() },
    { name: "Översikt", ready: () => page.getByRole("heading", { name: "Översikt" }).waitFor() },
  ];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const startedAt = Date.now();
  const stopAt = startedAt + soakMinutes * 60_000;
  const cycleDurations: number[] = [];
  const heapSamples: Array<{ elapsedMinutes: number; heap: HeapSnapshot }> = [];
  const initialHeap = await readHeap(page);
  let cycle = 0;
  let lastReportAt = startedAt;

  while (Date.now() < stopAt) {
    const cycleStart = Date.now();
    for (const view of viewButtons) {
      await page.getByRole("button", { name: view.name, exact: true }).click();
      await view.ready();
    }
    // The library tree is intentionally tucked behind its own sidebar popup
    // on the overview. Re-open the seeded lecture through the dashboard's
    // recent-lecture card instead of assuming its tree row is always mounted.
    await page
      .getByRole("button", { name: "Akut buk 2026-01-01", exact: true })
      .click();
    await expect(page.locator('input[value="Akut buk"]')).toBeVisible();

    if (cycle % 8 === 0) {
      await page.keyboard.press("Control+B");
      await page.keyboard.press("Control+B");
    }
    if (cycle % 12 === 0) {
      await page.setViewportSize({
        width: cycle % 24 === 0 ? 1024 : 1366,
        height: cycle % 24 === 0 ? 720 : 820,
      });
    }
    if (cycle % 20 === 0) {
      await page.keyboard.press("?");
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
    }

    cycleDurations.push(Date.now() - cycleStart);
    cycle += 1;
    if (cycle % 25 === 0) await page.waitForTimeout(1_000);

    if (Date.now() - lastReportAt >= 60_000) {
      heapSamples.push({
        elapsedMinutes: Math.round(((Date.now() - startedAt) / 60_000) * 10) / 10,
        heap: await readHeap(page),
      });
      console.log(
        `[Lectio soak progress] ${cycle} cycles, ${Math.round((Date.now() - startedAt) / 60_000)} min`,
      );
      lastReportAt = Date.now();
    }
  }

  const sortedDurations = [...cycleDurations].sort((a, b) => a - b);
  const p95 =
    sortedDurations[
      Math.floor(Math.max(0, sortedDurations.length - 1) * 0.95)
    ] ?? 0;
  const finalHeap = await readHeap(page);
  const report = {
    configuredMinutes: soakMinutes,
    elapsedMs: Date.now() - startedAt,
    cycles: cycle,
    cycleP95Ms: p95,
    initialHeap,
    heapSamples,
    finalHeap,
    runtimeErrors: errors,
  };
  console.log(`[Lectio soak report] ${JSON.stringify(report)}`);
  await test.info().attach("stability-soak.json", {
    body: `${JSON.stringify(report, null, 2)}\n`,
    contentType: "application/json",
  });

  expect(errors, "Renderer-fel under soak-körningen").toEqual([]);
  expect(cycle, "Soak-körningen måste ha gjort upprepade hela navigeringscykler").toBeGreaterThan(0);
  expect(p95, "95:e percentilen för navigeringscykler översteg 10 sekunder").toBeLessThan(10_000);
  if (finalHeap && initialHeap) {
    expect(finalHeap.usedMb, "Renderer-heap överskred 768 MB").toBeLessThan(768);
    expect(finalHeap.usedMb - initialHeap.usedMb, "Renderer-heap växte mer än 512 MB under soak").toBeLessThan(512);
  }
});
