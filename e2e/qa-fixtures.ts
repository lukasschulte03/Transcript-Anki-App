import { expect, test as base, type Page } from "@playwright/test";

export const seededNodes = [
  { id: "workspace-main", parentId: null, type: "workspace", title: "Mina studier", context: "", createdAt: "2026-01-01T00:00:00.000Z", settings: { language: "sv" } },
  { id: "course", parentId: "workspace-main", type: "course", title: "Kirurgi", context: "Kursens testcontext", createdAt: "2026-01-01T00:00:01.000Z", settings: {}, sortIndex: 0 },
  { id: "module", parentId: "course", type: "module", title: "Akut kirurgi", context: "", createdAt: "2026-01-01T00:00:02.000Z", settings: {}, sortIndex: 0 },
  { id: "lecture", parentId: "module", type: "lecture", title: "Akut buk", context: "", createdAt: "2026-01-01T00:00:03.000Z", settings: {}, sortIndex: 0 },
];

export async function seedLibrary(page: Page) {
  // Wait for the React shell before replacing its isolated test state.
  // A short settled frame prevents hydration from overwriting the fixture on
  // slower Windows/WebView machines, even when no default state is persisted.
  await page.getByRole("heading", { name: "Översikt" }).waitFor();
  await page.waitForTimeout(100);
  await page.evaluate((nodes: typeof seededNodes) => {
    const key = "lectio-state-v1";
    const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
    stored.state = {
      ...stored.state,
      nodes,
      lectures: {
        lecture: {
          lectureId: "lecture",
          notes: "Buksmärta och differentialdiagnoser.",
          slideAssetId: "slide-asset",
          slideName: "akut-buk.png",
          visualIndex: [{
            id: "visual-akut-buk",
            slidePage: 1,
            description: "Anatomisk bild av buken.",
            keywords: ["buk", "anatomi"],
            sourceHash: "fixture-slide",
          }],
        },
      },
      segments: [{ id: "segment", lectureId: "lecture", start: 0, end: 5, text: "Akut buk kräver snabb bedömning." }],
      markers: [],
      cards: [{ id: "approved-card", lectureId: "lecture", type: "basic", front: "Vad betyder akut buk?", back: "Buksmärta som kräver snabb bedömning.", tags: [], status: "approved", visualId: "visual-akut-buk", visualLectureId: "lecture" }],
      selectedId: "lecture",
      activeView: "workspace",
    };
    // Keep this fixture on the current persisted schema. A deliberately old
    // version belongs in a dedicated migration test; using one here reruns the
    // upgrade path and can replace the just-seeded library with defaults.
    stored.version = 16;
    localStorage.setItem(key, JSON.stringify(stored));
  }, seededNodes);
  await page.evaluate(async () => {
    const request = indexedDB.open("lectio-assets");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("assets", "readwrite");
    transaction.objectStore("assets").put({
      id: "slide-asset",
      lectureId: "lecture",
      kind: "slides",
      name: "akut-buk.png",
      mimeType: "image/png",
      blob: new Blob(["fixture-slide-image"], { type: "image/png" }),
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  });
}

/** Seeds twelve distinct local PDF assets without touching the user's library. */
export async function seedPdfStressLibrary(page: Page) {
  await seedLibrary(page);
  const lectures = Array.from({ length: 12 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return {
      id: `pdf-lecture-${number}`,
      title: `PDF-stress ${number}`,
      assetId: `pdf-asset-${number}`,
    };
  });
  await page.evaluate((stressLectures) => {
    const key = "lectio-state-v1";
    const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
    stored.state.nodes = [
      ...stored.state.nodes.filter((node: { id: string }) => node.id !== "lecture"),
      ...stressLectures.map((lecture, index) => ({
        id: lecture.id,
        parentId: "module",
        type: "lecture",
        title: lecture.title,
        context: "",
        createdAt: `2026-01-01T00:${String(index + 3).padStart(2, "0")}:00.000Z`,
        settings: {},
        sortIndex: index,
      })),
    ];
    stored.state.lectures = Object.fromEntries(
      stressLectures.map((lecture) => [
        lecture.id,
        {
          lectureId: lecture.id,
          notes: "",
          slideAssetId: lecture.assetId,
          slideName: `${lecture.title}.pdf`,
        },
      ]),
    );
    stored.state.selectedId = stressLectures[0].id;
    stored.state.activeView = "workspace";
    localStorage.setItem(key, JSON.stringify(stored));
  }, lectures);
  await page.reload();
  await page.locator('input[value="PDF-stress 01"]').waitFor();
  await page.evaluate(async (stressLectures) => {
    const request = indexedDB.open("lectio-assets");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("assets", "readwrite");
    const store = transaction.objectStore("assets");
    const pdf = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
    for (const lecture of stressLectures) {
      store.put({
        id: lecture.assetId,
        lectureId: lecture.id,
        kind: "slides",
        name: `${lecture.title}.pdf`,
        mimeType: "application/pdf",
        blob: new Blob([pdf], { type: "application/pdf" }),
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }, lectures);
  await page.reload();
  await page.locator('input[value="PDF-stress 01"]').waitFor();
  return lectures;
}

type QaFixtures = { runtimeErrors: string[] };

/** Turns browser runtime errors into test failures with an attached diagnostic. */
export const test = base.extend<QaFixtures>({
  runtimeErrors: async ({ page }, runFixture, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    await runFixture(errors);
    if (errors.length) {
      await testInfo.attach("runtime-errors.txt", {
        body: errors.join("\n"),
        contentType: "text/plain",
      });
    }
    expect(errors, "Renderer-konsolen innehöll fel").toEqual([]);
  },
});

export { expect };
