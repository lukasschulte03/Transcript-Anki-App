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
      lectures: { lecture: { lectureId: "lecture", notes: "Buksmärta och differentialdiagnoser." } },
      segments: [{ id: "segment", lectureId: "lecture", start: 0, end: 5, text: "Akut buk kräver snabb bedömning." }],
      markers: [],
      cards: [{ id: "approved-card", lectureId: "lecture", type: "basic", front: "Vad betyder akut buk?", back: "Buksmärta som kräver snabb bedömning.", tags: [], status: "approved" }],
      selectedId: "lecture",
      activeView: "workspace",
    };
    stored.version ??= 15;
    localStorage.setItem(key, JSON.stringify(stored));
  }, seededNodes);
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
