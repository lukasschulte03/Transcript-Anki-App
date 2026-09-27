import { expect, test } from "@playwright/test";

const nextMode = process.env.VITE_NEXT_E2E === "true";

test("Next håller sig responsiv genom en längre studiesession med stort transkript", async ({
  page,
}, testInfo) => {
  test.skip(!nextMode, "Körs av test:e2e:next.");
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator('[data-frontend="next"]')).toBeVisible();

  await page.evaluate(() => {
    const key = "lectio-state-v1:next";
    const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
    const createdAt = new Date().toISOString();
    const node = (
      id: string,
      parentId: string | null,
      type: string,
      title: string,
    ) => ({
      id,
      parentId,
      type,
      title,
      context: "",
      settings: {},
      createdAt,
    });
    stored.state = {
      ...stored.state,
      nodes: [
        node("workspace", null, "workspace", "Mina studier"),
        node("course", "workspace", "course", "Prestandakurs"),
        node("module", "course", "module", "Lång föreläsning"),
        node("lecture", "module", "lecture", "Långt transkript"),
      ],
      lectures: {
        lecture: { lectureId: "lecture", notes: "Testanteckning." },
      },
      segments: Array.from({ length: 5_000 }, (_, index) => ({
        id: `long-session-${index}`,
        lectureId: "lecture",
        start: index * 4,
        end: index * 4 + 4,
        text: `Klinisk genomgång av diagnostik och behandling, avsnitt ${index + 1}.`,
      })),
      markers: [],
      cards: [],
      selectedId: "lecture",
      activeView: "dashboard",
    };
    localStorage.setItem(key, JSON.stringify(stored));
  });

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Dina studier" }),
  ).toBeVisible();

  const navigation = [
    { key: "Control+4", heading: "Koppla din Google Drive-inkorg" },
    { key: "Control+5", heading: "Superåtgärder" },
    { key: "Control+,", heading: "Inställningar" },
    { key: "Control+1", heading: "Dina studier" },
  ];
  const navigationMs: number[] = [];
  for (let cycle = 0; cycle < 3; cycle += 1) {
    for (const destination of navigation) {
      const startedAt = await page.evaluate(() => performance.now());
      await page.keyboard.press(destination.key);
      await expect(
        page.getByRole("heading", { name: destination.heading, exact: true }),
      ).toBeVisible();
      await page.evaluate(() => new Promise(requestAnimationFrame));
      navigationMs.push(
        Math.round((await page.evaluate(() => performance.now())) - startedAt),
      );
    }
  }

  await page
    .locator(".study-sidebar")
    .getByRole("button", { name: "Långt transkript", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Långt transkript", exact: true }),
  ).toBeVisible();

  const renderer = await page.evaluate(() => ({
    domNodes: document.getElementsByTagName("*").length,
    mountedTranscriptRows: document.querySelectorAll(".lecture-transcript-row")
      .length,
  }));
  const report = {
    fixture: { transcriptSegments: 5_000 },
    navigationMs,
    renderer,
    budgetMsPerNavigation: 2_000,
  };
  await testInfo.attach("next-long-session-performance.json", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });

  expect(Math.max(...navigationMs)).toBeLessThan(2_000);
  expect(renderer.domNodes).toBeLessThan(10_000);
  expect(pageErrors).toEqual([]);
});

test("bakgrundsjobb staplas, expanderas och blockerar inte navigering", async ({
  page,
}) => {
  test.skip(!nextMode, "Körs av test:e2e:next.");
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Dina studier" }),
  ).toBeVisible();

  await page.evaluate(() => {
    const emit = (id: string, label: string, current: number, total: number) =>
      window.dispatchEvent(
        new CustomEvent("lectio:stability-progress", {
          detail: {
            id,
            kind: "vision",
            label,
            phase: "analyzing",
            status: "active",
            current,
            total,
            detail: `${current} av ${total} bilder`,
            cancellable: false,
          },
        }),
      );
    emit("qa-notice-1", "OCR – testföreläsning", 3, 10);
    emit("qa-notice-2", "Transkribering – testföreläsning", 0, 4);
  });

  const center = page.locator(".notification-center");
  await expect(center).toBeVisible();
  await expect(
    center.getByText("Transkribering – testföreläsning"),
  ).toBeVisible();

  await center.hover();
  await expect(
    center.getByText("OCR – testföreläsning", { exact: true }),
  ).toBeVisible();
  await expect(center.getByText("30%", { exact: true })).toBeVisible();
  await expect(
    center.getByRole("progressbar", { name: "OCR – testföreläsning" }),
  ).toHaveAttribute("aria-valuenow", "30");
  await page.keyboard.press("Control+5");
  await expect(
    page.getByRole("heading", { name: "Superåtgärder" }),
  ).toBeVisible();
  await expect(center).toBeVisible();
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
});
