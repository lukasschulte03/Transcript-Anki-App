import { expect, seedLibrary, test } from "./qa-fixtures";

test("navigering, kortkommandon och sidofält fungerar i en isolerad profil", async ({ page }) => {
  await page.goto("/");
  await seedLibrary(page);
  await page.reload();

  await page.getByRole("button", { name: "Översikt", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Översikt" })).toBeVisible();

  await page.getByRole("button", { name: "Anki-kort", exact: true }).click();
  await expect(page.getByText("Generera nya kort")).toBeVisible();

  await page.getByRole("button", { name: "Inkorg", exact: true }).click();
  await expect(page.getByText("Google Drive-inkorg")).toBeVisible();

  await page.getByRole("button", { name: "Super Actions", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Super Actions" })).toBeVisible();

  await page.keyboard.press("Control+,");
  await expect(page.getByText("Inställningar").first()).toBeVisible();

  await page.keyboard.press("Control+B");
  await expect(page.getByRole("button", { name: "Visa sidofält (Ctrl+B)" })).toBeVisible();
  await page.keyboard.press("Control+B");
  await expect(page.getByRole("button", { name: "Dölj sidofält (Ctrl+B)" })).toBeVisible();
});

test("appskalet har en stabil visuell baslinje", async ({ page }) => {
  await page.goto("/");
  await seedLibrary(page);
  await page.reload();
  await page.getByRole("button", { name: "Översikt", exact: true }).click();
  await expect(page.locator("#root")).toHaveScreenshot("app-shell-light.png", {
    animations: "disabled",
  });
});
