import { expect, seedLibrary, seedPdfStressLibrary, test } from "./qa-fixtures";
import type { Page } from "@playwright/test";

const views = [
  { label: "Översikt", ready: "Översikt", snapshot: "view-dashboard.png" },
  { label: "Bibliotek", ready: "Akut buk", snapshot: "view-library.png" },
  { label: "Anki-kort", ready: "Generera nya kort", snapshot: "view-cards.png" },
  { label: "Inkorg", ready: "Din Google Drive-inkorg", snapshot: "view-inbox.png" },
  { label: "Super Actions", ready: "Super Actions", snapshot: "view-super-actions.png" },
  { label: "Inställningar", ready: "Inställningar", snapshot: "view-settings.png" },
] as const;

async function expectViewportFilled(page: Page) {
  // This declaration is replaced below by the browser-side assertion; keeping
  // it local makes the resize invariant explicit in each regression scenario.
  await page.evaluate(() => {
    const root = document.querySelector("#root")?.getBoundingClientRect();
    if (!root || root.width < window.innerWidth - 2 || root.height < window.innerHeight - 2) {
      throw new Error("Appskalet fyller inte WebView-ytan efter navigation.");
    }
    if (document.documentElement.scrollWidth > window.innerWidth + 1) {
      throw new Error("Appskalet har oavsiktlig horisontell scrollning.");
    }
  });
}

test("kritiska vyer har granskade visuella baslinjer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await seedLibrary(page);
  await page.reload();

  for (const view of views) {
    const navigationButton =
      view.label === "Inställningar"
        ? page.getByRole("button", { name: /^Inställningar/ })
        : page.getByRole("button", { name: view.label, exact: true });
    await navigationButton.click();
    if (view.label === "Bibliotek") {
      await expect(page.locator('input[value="Akut buk"]')).toBeVisible();
    } else {
      await expect(page.getByText(view.ready, { exact: true }).first()).toBeVisible();
    }
    await expectViewportFilled(page);
    await expect(page.locator("#root")).toHaveScreenshot(view.snapshot, {
      animations: "disabled",
      mask: [page.getByText(/Lectio · v/)],
    });
  }
});

test("navigation, sidofält och föreläsningsyta förblir stabila under lång körning", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto("/");
  await seedLibrary(page);
  await page.reload();

  const sequence = ["Bibliotek", "Anki-kort", "Inkorg", "Super Actions", "Översikt"] as const;
  for (let iteration = 0; iteration < 15; iteration += 1) {
    const label = sequence[iteration % sequence.length];
    await page.getByRole("button", { name: label, exact: true }).click();
    if (label === "Bibliotek") {
      await expect(page.locator('input[value="Akut buk"]')).toBeVisible();
    } else {
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
    if (iteration % 3 === 0) {
      await page.keyboard.press("Control+B");
      await page.keyboard.press("Control+B");
    }
    if (iteration % 4 === 0) {
      await page.setViewportSize({
        width: iteration % 8 === 0 ? 1024 : 1366,
        height: iteration % 8 === 0 ? 720 : 820,
      });
    }
    await expectViewportFilled(page);
  }
});

test("tolv PDF-föreläsningar kan växlas utan frusen panel eller kvarvarande laddare", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  const lectures = await seedPdfStressLibrary(page);

  for (const lecture of lectures) {
    await page.getByRole("button", { name: lecture.title, exact: true }).click();
    await expect(page.locator(`iframe[title="PDF: ${lecture.title}.pdf"]`)).toBeVisible();
    await expect(page.getByLabel("Laddar PDF")).toBeHidden({ timeout: 4_000 });
    await expect(page.locator('input[value="' + lecture.title + '"]')).toBeVisible();
    await expectViewportFilled(page);
  }
});

test("dialoger och kortkommandon kan öppnas och stängas utan att lämna UI:t låst", async ({ page }) => {
  await page.goto("/");
  await seedLibrary(page);
  await page.reload();

  await page.keyboard.press("?");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.getByRole("button", { name: "Bibliotek", exact: true }).click();
  await page.getByRole("button", { name: "Akut buk", exact: true }).click();
  await page.getByRole("button", { name: "Importera text" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator('input[value="Akut buk"]')).toBeVisible();
});
