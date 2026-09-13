import { expect, seedLibrary, test } from "./qa-fixtures";

test("visar ett startupskal även innan applikationskoden körs", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await context.newPage();
  await staticPage.goto("/");
  await expect(staticPage.getByText("Startar din arbetsyta…")).toBeVisible();
  await context.close();
});

test("öppnar ett realistiskt stort bibliotek inom startupbudgeten", async ({ page }) => {
  await page.goto("/");
  await seedLibrary(page);
  await page.reload();
  await page.locator('input[value="Akut buk"]').waitFor();

  await page.evaluate(() => {
    const key = "lectio-state-v1";
    const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
    const text =
      "Ett medicinskt transcriptsegment med klinisk information, differentialdiagnostik och behandling. ";
    stored.state.segments = Array.from({ length: 7_500 }, (_, index) => ({
      id: `startup-segment-${index}`,
      lectureId: "lecture",
      start: index * 5,
      end: index * 5 + 5,
      text: `${text}${index}`,
    }));
    localStorage.setItem(key, JSON.stringify(stored));
  });

  const startedAt = Date.now();
  await page.reload();
  await expect(page.getByText("Akut buk", { exact: true }).first()).toBeVisible({
    timeout: 3_000,
  });
  expect(Date.now() - startedAt).toBeLessThan(3_000);
});

test("återhämtar ett trasigt persistensvärde utan vit skärm", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("heading", { name: "Översikt" }).waitFor();
  await page.evaluate(() =>
    localStorage.setItem("lectio-state-v1", "{trasig-json"),
  );

  await page.reload();
  await expect(page.getByRole("heading", { name: "Översikt" })).toBeVisible({
    timeout: 3_000,
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(localStorage.getItem("lectio-state-v1-corrupt-backup")),
      ),
    )
    .toBe(true);
});
