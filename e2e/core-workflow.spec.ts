import { databaseName, expect, seedLibrary, test } from "./qa-fixtures";

test("studentens lokala kärnflöde: material, kortgranskning och mockad Anki-synk", async ({
  page,
}) => {
  await page.goto("/");
  await seedLibrary(page);
  await page.reload();

  await expect(page.locator('input[value="Akut buk"]')).toBeVisible();
  await page.locator('input[accept^="audio/*"]').setInputFiles({
    name: "forelasning.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("RIFF0000WAVEfmt "),
  });
  await expect(page.getByText("Transkribera", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Skapa kort" }).click();
  await expect(page.getByText("Generera nya kort")).toBeVisible();
  await page.getByRole("button", { name: "Fortsätt" }).click();
  await page
    .getByPlaceholder('{"cards":[…]}')
    .fill(
      '{"cards":[{"type":"basic","front":"Vad är peritonit?","back":"Inflammation i peritoneum.","tags":[]}]}',
    );
  await page.getByRole("button", { name: "Validera och importera" }).click();
  await expect(
    page.getByText("Vad är peritonit?", { exact: true }),
  ).toBeVisible();

  await page.route("http://127.0.0.1:8765/**", async (route) => {
    const request = route.request();
    const body = JSON.parse(request.postData() ?? "{}") as { action?: string };
    const result =
      body.action === "deckNames"
        ? []
        : body.action === "modelFieldNames"
          ? ["Front", "Back"]
          : 101;
    await route.fulfill({ json: { result, error: null } });
  });
  await page.evaluate(() => {
    (
      window as Window & { __LECTIO_STABILITY_ALLOW_LOOPBACK__?: boolean }
    ).__LECTIO_STABILITY_ALLOW_LOOPBACK__ = true;
  });
  await page.getByRole("button", { name: "Synka godkända" }).click();
  await page.waitForFunction(() => {
    const stored = JSON.parse(localStorage.getItem("lectio-state-v1") ?? "{}");
    return stored.state?.cards?.some(
      (card: { id: string; status: string; ankiId?: number }) =>
        card.id === "approved-card" &&
        card.status === "synced" &&
        card.ankiId === 101,
    );
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Radera visade" }).click();
  await expect(page.getByText("Inga kort här ännu")).toBeVisible();

  await page.getByRole("button", { name: "Bibliotek", exact: true }).click();
  await page.getByRole("button", { name: "Akut buk", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Ta bort ljudfil från föreläsningen" })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByText("Ingen ljudfil ännu")).toBeVisible();
});

test("exporterar och importerar lokal context och filer", async ({ page }) => {
  await page.goto("/");
  await seedLibrary(page);
  await page.reload();
  await page.locator('input[accept^="audio/*"]').setInputFiles({
    name: "kursmaterial.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("RIFF0000WAVEfmt "),
  });
  await expect(page.getByText("Transkribera", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Inställningar/ }).click();
  await page.getByRole("button", { name: "Allmänt" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportera bibliotek" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Kunde inte läsa den exporterade testfilen");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));

  // The imported archive, not the pre-existing IndexedDB asset, must restore
  // the source image and the card's stable visual reference.
  await page.evaluate(async (name) => {
    const request = indexedDB.open(name);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("assets", "readwrite");
    transaction.objectStore("assets").delete("slide-asset");
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }, databaseName);

  await page
    .locator('input[accept="application/json,.zip,application/zip"]')
    .setInputFiles({
      name: download.suggestedFilename(),
      mimeType: "application/zip",
      buffer: Buffer.concat(chunks),
    });
  await expect(page.getByText("Biblioteket importerades")).toBeVisible();
  await page.waitForFunction(() => {
    const stored = JSON.parse(localStorage.getItem("lectio-state-v1") ?? "{}");
    const lecture = stored.state?.lectures?.lecture;
    const card = stored.state?.cards?.find(
      (item: { id: string }) => item.id === "approved-card",
    );
    return (
      stored.state?.nodes?.some(
        (node: { id: string; context: string }) =>
          node.id === "course" && node.context === "Kursens testcontext",
      ) &&
      lecture?.visualIndex?.[0]?.id === "visual-akut-buk" &&
      card?.visualId === "visual-akut-buk"
    );
  });
  await page.waitForFunction(async (name) => {
    const request = indexedDB.open(name);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("assets", "readonly");
    const item = await new Promise<unknown>((resolve, reject) => {
      const get = transaction.objectStore("assets").get("slide-asset");
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
    database.close();
    return Boolean(item);
  }, databaseName);
});
