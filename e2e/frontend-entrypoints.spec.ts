import { expect, test } from "@playwright/test";

const nextMode = process.env.VITE_NEXT_E2E === "true";

test("Next använder kontraktet och en isolerad persistent profil", async ({
  page,
}) => {
  test.skip(!nextMode, "Körs av test:e2e:next.");
  await page.goto("/");
  await expect(page.locator('[data-frontend="next"]')).toBeVisible();
  await expect(page.getByText("Next · next")).toBeVisible();
  await expect(page.getByText("Mina studier", { exact: true })).toBeVisible();
  await expect(page.getByText("Super Actions", { exact: true })).toHaveCount(0);

  page.once("dialog", (dialog) => dialog.accept("Medicin"));
  await page.getByRole("button", { name: "Skapa kurs" }).click();
  await expect(page.getByRole("button", { name: "Medicin" })).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() => ({
        next: Boolean(localStorage.getItem("lectio-state-v1:next")),
        main: Boolean(localStorage.getItem("lectio-state-v1")),
      })),
    )
    .toEqual({ next: true, main: false });

  await page.reload();
  await expect(page.getByRole("button", { name: "Medicin" })).toBeVisible();
});

test("två fönster kan inte skriva till samma dataprofil", async ({
  page,
  context,
}) => {
  test.skip(!nextMode, "Körs av test:e2e:next.");
  await page.goto("/");
  await expect(page.locator('[data-frontend="next"]')).toBeVisible();
  const second = await context.newPage();
  await second.goto("/");
  await expect(second.getByText("Lectio kunde inte starta")).toBeVisible();
  await expect(second.getByText(/profilen är redan öppen/i)).toBeVisible();
  await second.close();
});
