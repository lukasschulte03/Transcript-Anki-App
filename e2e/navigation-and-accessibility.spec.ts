import { expect, seedLibrary, test } from "./qa-fixtures";

test("navigering, kortkommandon och sidofält fungerar i en isolerad profil", async ({
  page,
}) => {
  await page.goto("/");
  await seedLibrary(page);
  await page.reload();

  await expect(
    page.getByRole("button", { name: "Synka med Google Drive" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Översikt", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Översikt" })).toBeVisible();

  await page.getByRole("button", { name: "Akut buk", exact: true }).click();
  await page
    .locator('input[value="Akut buk"]')
    .evaluate((element) => (element.dataset.workspaceInstance = "preserved"));
  await page.keyboard.press("Control+3");
  await expect(
    page.getByRole("dialog", { name: "Anki-arbetsyta" }),
  ).toBeVisible();
  await expect(page.getByText("Generera nya kort")).toBeVisible();
  await page.getByRole("button", { name: "Stäng Anki-arbetsytan" }).click();
  await expect(
    page.locator(
      'input[value="Akut buk"][data-workspace-instance="preserved"]',
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Inkorg", exact: true }).click();
  await expect(page.getByText("Google Drive-inkorg")).toBeVisible();
  const libraryTree = page.locator("aside").filter({ hasText: "Mina studier" });
  await expect(libraryTree).toBeVisible();

  await page
    .getByRole("button", { name: "Super Actions", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Super Actions" }),
  ).toBeVisible();

  await page.keyboard.press("Control+4");
  await expect(page.getByText("Google Drive-inkorg")).toBeVisible();

  await page.keyboard.press("Control+5");
  await expect(
    page.getByRole("heading", { name: "Super Actions" }),
  ).toBeVisible();
  await expect(libraryTree).toBeVisible();

  await page.keyboard.press("Control+,");
  await expect(page.getByText("Inställningar").first()).toBeVisible();
  await expect(libraryTree).toBeVisible();

  await page.keyboard.press("Control+2");
  await expect(libraryTree).toBeVisible();

  await page.keyboard.press("Control+B");
  await expect(
    page.getByRole("button", { name: "Visa sidofält (Ctrl+B)" }),
  ).toBeVisible();
  await page.keyboard.press("Control+B");
  await expect(
    page.getByRole("button", { name: "Dölj sidofält (Ctrl+B)" }),
  ).toBeVisible();
});

test("appskalet har en stabil visuell baslinje", async ({ page }) => {
  await page.goto("/");
  await seedLibrary(page);
  await page.reload();
  await page.getByRole("button", { name: "Översikt", exact: true }).click();
  await expect(page.locator("#root")).toHaveScreenshot("app-shell-light.png", {
    animations: "disabled",
    // The footer carries the app version, which legitimately changes every
    // release and should not invalidate the visual layout baseline.
    mask: [page.getByText(/Lectio · v/)],
  });
});

test("biblioteket blir en tillfällig panel i ett smalt fönster", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto("/");
  await seedLibrary(page);
  await page.reload();

  await expect(
    page.getByRole("button", { name: "Öppna bibliotek" }),
  ).toBeVisible();
  await expect(page.locator('[aria-label="Bibliotek"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Öppna bibliotek" }).click();
  await expect(page.getByLabel("Tillfälligt bibliotek")).toBeVisible();
  await page.getByRole("button", { name: "Kirurgi", exact: true }).click();
  await expect(page.getByLabel("Tillfälligt bibliotek")).toBeHidden();
  await expect(page.locator('input[value="Kirurgi"]')).toBeVisible();
  await expect(page.locator("#root")).not.toHaveCSS("overflow-x", "auto");
});

test("playback är renodlad, responsiv och behåller sina kortkommandon", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 820 });
  await page.goto("/");
  await seedLibrary(page);
  await page.reload();
  await page.locator('input[accept^="audio/*"]').setInputFiles({
    name: "playback.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("RIFF0000WAVEfmt "),
  });

  const panel = page.locator("[data-lectio-audio-panel]");
  const controls = page.locator("[data-lectio-playback-controls]");
  await expect(
    controls.getByRole("button", { name: "Hoppa 10 sekunder bakåt" }),
  ).toBeVisible();
  await expect(
    controls.getByRole("button", { name: "Hoppa 10 sekunder framåt" }),
  ).toBeVisible();
  await expect(
    controls.getByRole("button", { name: "Stäng av ljud" }),
  ).toBeVisible();
  await expect(controls.getByText("Transkribera", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    controls.getByText("Markera viktigt", { exact: true }),
  ).toHaveCount(0);

  await controls
    .getByRole("button", { name: "Hoppa 10 sekunder framåt" })
    .click();
  await expect(controls.getByRole("status")).toHaveText("+10 s");
  await page
    .getByRole("button", { name: "Markera viktigt vid aktuell ljudposition" })
    .click();
  await expect(page.getByText("Markeringar 1")).toBeVisible();

  await page.getByRole("button", { name: "Transkribera ljud" }).first().click();
  await expect(
    page.getByRole("dialog", { name: "Transkribera ljud" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Transkribera ljud" }),
  ).toBeHidden();

  const expectNoOverflow = async () => {
    expect(
      await panel.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
  };
  await expectNoOverflow();
  await page.keyboard.press("Control+B");
  await expectNoOverflow();
  await page.setViewportSize({ width: 800, height: 700 });
  await expectNoOverflow();
  await page.keyboard.press("ArrowLeft");
  await expect(controls.getByRole("status")).toHaveText("−10 s");
});
