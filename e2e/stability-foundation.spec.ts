import { test as base, expect as baseExpect } from "@playwright/test";
import { expect, seedLibrary, test } from "./qa-fixtures";

const stabilityMode = process.env.VITE_STABILITY_TEST === "true";

test("stability-profilen isolerar biblioteket och visar bakgrundsjobb", async ({
  page,
}) => {
  test.skip(!stabilityMode, "Körs endast av qa:stability.");
  await page.goto("/");
  await seedLibrary(page);
  await page.reload();
  await page.locator('input[value="Akut buk"]').waitFor();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const databaseNames = await page.evaluate(async () =>
    (await indexedDB.databases()).map((database) => database.name),
  );
  expect(databaseNames).toContain("lectio-assets-stability");
  expect(databaseNames).not.toContain("lectio-assets");

  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("lectio:stability-progress", {
        detail: {
          id: "stability-progress",
          kind: "transcription",
          label: "Stability-transkribering",
          phase: "transcribing",
          status: "active",
          current: 3,
          total: 10,
          detail: "3 av 10 segment",
        },
      }),
    );
  });
  await expect(page.getByText("Stability-transkribering")).toBeVisible();
  await expect(page.getByText("30%")).toBeVisible();
  await expect(page.locator("#root")).toHaveScreenshot("progress-active.png", {
    animations: "disabled",
    mask: [page.getByText(/Lectio · v/)],
  });
});

test("progressuppdateringar ersätter samma jobb och fel kan stängas", async ({
  page,
}) => {
  test.skip(!stabilityMode, "Körs endast av qa:stability.");
  await page.goto("/");
  await seedLibrary(page);
  await page.reload();
  await page.locator('input[value="Akut buk"]').waitFor();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

  const publish = (status: "active" | "error", current: number, detail: string) =>
    page.evaluate(
      ({ status, current, detail }) => {
        window.dispatchEvent(
          new CustomEvent("lectio:stability-progress", {
            detail: {
              id: "progress-lifecycle",
              kind: "transcription",
              label: "Livscykeltest",
              phase: status === "active" ? "transcribing" : "error",
              status,
              current,
              total: 10,
              detail,
            },
          }),
        );
      },
      { status, current, detail },
    );

  await publish("active", 2, "2 av 10 segment");
  await expect(page.getByText("20%")).toBeVisible();
  await publish("active", 8, "8 av 10 segment");
  await expect(page.getByText("80%")).toBeVisible();
  await expect(page.getByText("Livscykeltest", { exact: true })).toHaveCount(1);

  await publish("error", 8, "Testfel");
  await expect(page.getByText("Testfel")).toBeVisible();
  await page.getByRole("button", { name: "Stäng uppgift" }).click();
  await expect(page.getByText("Livscykeltest", { exact: true })).toHaveCount(0);
});

base(
  "den globala error boundaryn återhämtar ett renderingsfel",
  async ({ page }) => {
    base.skip(!stabilityMode, "Körs endast av qa:stability.");
    await page.goto("/");
    await page.evaluate(() =>
      sessionStorage.setItem("lectio-stability-force-render-error", "1"),
    );
    await page.reload();
    await baseExpect(
      page.getByRole("heading", { name: "Lectio stötte på ett problem" }),
    ).toBeVisible();
    // A page screenshot is reliable here. Chromium can capture an empty
    // element image for #root immediately after React replaces a crashed tree.
    await baseExpect(page).toHaveScreenshot("error-boundary.png", {
      animations: "disabled",
    });
    await page.evaluate(() =>
      sessionStorage.removeItem("lectio-stability-force-render-error"),
    );
    await page.reload();
    await baseExpect(
      page.getByRole("heading", { name: "Översikt" }),
    ).toBeVisible();
  },
);
