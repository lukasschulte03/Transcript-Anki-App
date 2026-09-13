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
    await baseExpect(page.locator("#root")).toHaveScreenshot("error-boundary.png", {
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
