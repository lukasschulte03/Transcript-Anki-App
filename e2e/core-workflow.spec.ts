import { expect, test, type Page } from "@playwright/test";

const seededNodes = [
  { id: "workspace-main", parentId: null, type: "workspace", title: "Mina studier", context: "", createdAt: "2026-01-01T00:00:00.000Z", settings: { language: "sv" } },
  { id: "course", parentId: "workspace-main", type: "course", title: "Kirurgi", context: "Kursens testcontext", createdAt: "2026-01-01T00:00:01.000Z", settings: {}, sortIndex: 0 },
  { id: "module", parentId: "course", type: "module", title: "Akut kirurgi", context: "", createdAt: "2026-01-01T00:00:02.000Z", settings: {}, sortIndex: 0 },
  { id: "lecture", parentId: "module", type: "lecture", title: "Akut buk", context: "", createdAt: "2026-01-01T00:00:03.000Z", settings: {}, sortIndex: 0 },
];

async function seedLibrary(page: Page) {
  await page.evaluate((nodes: typeof seededNodes) => {
    const key = "lectio-state-v1";
    const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
    stored.state = {
      ...stored.state,
      nodes,
      lectures: { lecture: { lectureId: "lecture", notes: "Buksmärta och differentialdiagnoser." } },
      segments: [{ id: "segment", lectureId: "lecture", start: 0, end: 5, text: "Akut buk kräver snabb bedömning." }],
      markers: [],
      cards: [{ id: "approved-card", lectureId: "lecture", type: "basic", front: "Vad betyder akut buk?", back: "Buksmärta som kräver snabb bedömning.", tags: [], status: "approved" }],
      selectedId: "lecture",
      activeView: "workspace",
    };
    stored.version ??= 9;
    localStorage.setItem(key, JSON.stringify(stored));
  }, seededNodes);
}

test("studentens lokala kärnflöde: material, kortgranskning och mockad Anki-synk", async ({ page }) => {
  await page.goto("/");
  await seedLibrary(page);
  await page.reload();

  await expect(page.locator('input[value="Akut buk"]')).toBeVisible();
  await page.locator('input[accept="audio/*"]').setInputFiles({
    name: "forelasning.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("RIFF0000WAVEfmt "),
  });
  await expect(page.getByText("Transkribera", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Skapa kort" }).click();
  await expect(page.getByText("Generera nya kort")).toBeVisible();
  await page.getByRole("button", { name: "Fortsätt" }).click();
  await page.getByPlaceholder('{"cards":[…]}').fill('{"cards":[{"type":"basic","front":"Vad är peritonit?","back":"Inflammation i peritoneum.","tags":[]}]}');
  await page.getByRole("button", { name: "Validera och importera" }).click();
  await expect(page.getByText("Vad är peritonit?", { exact: true })).toBeVisible();

  await page.route("http://127.0.0.1:8765/**", async (route) => {
    const request = route.request();
    const body = JSON.parse(request.postData() ?? "{}") as { action?: string };
    const result = body.action === "deckNames"
      ? []
      : body.action === "modelFieldNames"
        ? ["Front", "Back"]
        : 101;
    await route.fulfill({ json: { result, error: null } });
  });
  await page.getByRole("button", { name: "Synka godkända" }).click();
  await page.waitForFunction(() => {
    const stored = JSON.parse(localStorage.getItem("lectio-state-v1") ?? "{}");
    return stored.state?.cards?.some(
      (card: { id: string; status: string; ankiId?: number }) =>
        card.id === "approved-card" && card.status === "synced" && card.ankiId === 101,
    );
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Radera visade" }).click();
  await expect(page.getByText("Inga kort här ännu")).toBeVisible();

  await page.getByRole("button", { name: "Bibliotek", exact: true }).click();
  await page.getByRole("button", { name: "Akut buk" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Ta bort ljudfil från föreläsningen" }).evaluate(
    (button: HTMLButtonElement) => button.click(),
  );
  await expect(page.getByText("Ingen ljudfil ännu")).toBeVisible();
});

test("exporterar och importerar lokal context och filer", async ({ page }) => {
  await page.goto("/");
  await seedLibrary(page);
  await page.reload();
  await page.locator('input[accept="audio/*"]').setInputFiles({
    name: "kursmaterial.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("RIFF0000WAVEfmt "),
  });
  await expect(page.getByText("Transkribera", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Inställningar/ }).click();
  await page.getByRole("button", { name: "Generellt" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportera bibliotek" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Kunde inte läsa den exporterade testfilen");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));

  await page.locator('input[accept="application/json,.zip,application/zip"]').setInputFiles({
    name: download.suggestedFilename(),
    mimeType: "application/zip",
    buffer: Buffer.concat(chunks),
  });
  await expect(page.getByText("Biblioteket importerades")).toBeVisible();
  await page.waitForFunction(() => {
    const stored = JSON.parse(localStorage.getItem("lectio-state-v1") ?? "{}");
    return stored.state?.nodes?.some(
      (node: { id: string; context: string }) => node.id === "course" && node.context === "Kursens testcontext",
    );
  });
});
