import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./qa-fixtures";

const nextMode = process.env.VITE_NEXT_E2E === "true";
const stateKey = "lectio-state-v1:next";

async function seedLecture(page: import("@playwright/test").Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-frontend="next"]')).toBeVisible();
  await page.waitForTimeout(350);
  await page.evaluate((key) => {
    const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
    const createdAt = "2026-01-01T00:00:00.000Z";
    stored.state = {
      ...stored.state,
      nodes: [
        {
          id: "workspace",
          parentId: null,
          type: "workspace",
          title: "Mina studier",
          createdAt,
          context: "",
          settings: {},
        },
        {
          id: "course",
          parentId: "workspace",
          type: "course",
          title: "Klinisk medicin",
          createdAt,
          context: "Kursens medicinska kontext",
          settings: {},
        },
        {
          id: "module",
          parentId: "course",
          type: "module",
          title: "Urologi",
          createdAt,
          context: "Modulens fokus",
          settings: {},
        },
        {
          id: "lecture",
          parentId: "module",
          type: "lecture",
          title: "Prostatacancer",
          createdAt,
          context: "",
          settings: {},
        },
      ],
      lectures: {
        lecture: { lectureId: "lecture", notes: "Första anteckningen." },
      },
      segments: [
        {
          id: "segment-1",
          lectureId: "lecture",
          start: 0,
          end: 5,
          text: "PSA används i diagnostik och uppföljning.",
        },
        {
          id: "segment-2",
          lectureId: "lecture",
          start: 6,
          end: 12,
          text: "Behandling väljs efter riskgrupp och samsjuklighet.",
        },
      ],
      markers: [],
      cards: [
        {
          id: "generated-card",
          lectureId: "lecture",
          type: "basic",
          front: "Vad används PSA till?",
          back: "Diagnostik och uppföljning.",
          tags: [],
          status: "generated",
        },
      ],
      selectedId: "lecture",
      activeView: "workspace",
    };
    stored.version = 19;
    localStorage.setItem(key, JSON.stringify(stored));
  }, stateKey);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Prostatacancer", exact: true }),
  ).toBeVisible();
}

test("föreläsningsflöde söker och redigerar transkript, sparar anteckningar och granskar kort", async ({
  page,
}) => {
  test.skip(!nextMode, "Körs av test:e2e:next.");
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await seedLecture(page);

  const search = page.getByRole("searchbox", { name: "Sök i transkriptet" });
  await search.fill("diagnostik");
  await expect(page.locator(".lecture-transcript-row")).toHaveCount(1);
  await expect(page.locator(".lecture-transcript-row mark")).toHaveText(
    "diagnostik",
  );
  await page.locator(".lecture-transcript-text").click();
  const edit = page.locator('textarea[name="transcript-segment-segment-1"]');
  await edit.fill("PSA används för diagnostik och uppföljning.");
  await search.click();
  await expect(page.locator(".lecture-transcript-text")).toContainText(
    "uppföljning",
  );

  await page.getByRole("tab", { name: "Anteckningar" }).click();
  const notes = page.getByRole("textbox", { name: "Anteckningar" });
  await notes.fill("Repetera PSA och riskstratifiering inför seminariet.");
  await notes.blur();
  await expect(page.getByText("Sparat lokalt", { exact: true })).toBeVisible();

  await page
    .getByRole("button", { name: "Öppna Anki-kort för Prostatacancer" })
    .click();
  const cards = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Anki-kort", exact: true }),
  });
  await expect(cards.getByText("Vad används PSA till?")).toBeVisible();
  await cards.getByRole("button", { name: "Godkänn", exact: true }).click();
  await expect(
    cards.getByText(/1 kort · 0 att granska · 1 godkända/),
  ).toBeVisible();
  await expect(
    cards.getByRole("button", { name: "Synka godkända", exact: true }),
  ).toBeEnabled();
  await cards.getByRole("button", { name: "Stäng", exact: true }).click();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Prostatacancer", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Anteckningar" }).click();
  await expect(page.getByRole("textbox", { name: "Anteckningar" })).toHaveValue(
    "Repetera PSA och riskstratifiering inför seminariet.",
  );
  await page
    .getByRole("button", { name: "Öppna Anki-kort för Prostatacancer" })
    .click();
  await expect(
    page.getByRole("dialog").getByText(/1 kort · 0 att granska · 1 godkända/),
  ).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test("inställningssökning leder till rätt val och färgtema överlever omstart", async ({
  page,
}) => {
  test.skip(!nextMode, "Körs av test:e2e:next.");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Dina studier", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+,");
  await expect(
    page.getByRole("heading", { name: "Inställningar", exact: true }),
  ).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Sök inställningar" });
  await search.fill("grafikkort");
  const acceleration = page
    .getByRole("button", { name: /Acceleration/ })
    .first();
  await expect(acceleration).toBeVisible();
  await acceleration.click();
  await expect(
    page.getByRole("heading", { name: "Transkribering", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#transcription-acceleration")).toBeVisible();

  await page.getByRole("button", { name: "Utseende", exact: true }).click();
  const theme = page.getByRole("radio", { name: "Glöd Mörkt", exact: true });
  await expect(theme).toBeVisible();
  await theme.click();
  await expect(page.locator(".study-shell")).toHaveAttribute(
    "data-theme",
    "orange-dark",
  );
  await page.reload();
  await expect(page.locator(".study-shell")).toHaveAttribute(
    "data-theme",
    "orange-dark",
  );
  await expect(
    page.getByRole("heading", { name: "Inställningar", exact: true }),
  ).toBeVisible();
});

test("centrala vyer och små fönster behåller läsbar layout utan horisontell overflow", async ({
  page,
}) => {
  test.skip(!nextMode, "Körs av test:e2e:next.");
  await page.setViewportSize({ width: 1024, height: 700 });
  await seedLecture(page);
  const viewportHasNoHorizontalOverflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
  expect(await viewportHasNoHorizontalOverflow()).toBe(true);

  for (const [shortcut, heading] of [
    ["Control+4", "Koppla din Google Drive-inkorg"],
    ["Control+5", "Superåtgärder"],
    ["Control+,", "Inställningar"],
    ["Control+1", "Dina studier"],
  ]) {
    await page.keyboard.press(shortcut);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    expect(
      await viewportHasNoHorizontalOverflow(),
      `${heading} ska rymmas i fönstret`,
    ).toBe(true);
  }

  await page.setViewportSize({ width: 760, height: 680 });
  for (const [shortcut, heading] of [
    ["Control+4", "Koppla din Google Drive-inkorg"],
    ["Control+5", "Superåtgärder"],
    ["Control+,", "Inställningar"],
    ["Control+1", "Dina studier"],
  ]) {
    await page.keyboard.press(shortcut);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    expect(
      await viewportHasNoHorizontalOverflow(),
      `${heading} ska rymmas i smalt fönster`,
    ).toBe(true);
  }
});

test("Next-vyer följer automatiska WCAG 2.1 AA-tillgänglighetskontroller", async ({
  page,
}, testInfo) => {
  test.skip(!nextMode, "Körs av test:e2e:next.");
  test.setTimeout(90_000);
  await seedLecture(page);
  const violations: Array<{
    view: string;
    id: string;
    impact?: string;
    help: string;
    nodes: Array<{ target: string[]; summary: string }>;
  }> = [];
  const audit = async (view: string) => {
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    for (const violation of result.violations) {
      violations.push({
        view,
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.map((node) => ({
          target: node.target.map(String),
          summary: node.failureSummary ?? "",
        })),
      });
    }
  };

  await audit("Föreläsning · ljust tema");
  await page.keyboard.press("Control+4");
  await expect(
    page.getByRole("heading", {
      name: "Koppla din Google Drive-inkorg",
      exact: true,
    }),
  ).toBeVisible();
  await audit("Inkorg · ljust tema");
  await page.keyboard.press("Control+5");
  await expect(
    page.getByRole("heading", { name: "Superåtgärder", exact: true }),
  ).toBeVisible();
  await audit("Superåtgärder · ljust tema");
  await page.keyboard.press("Control+,");
  await expect(
    page.getByRole("heading", { name: "Inställningar", exact: true }),
  ).toBeVisible();
  await audit("Inställningar · ljust tema");

  await page.getByRole("button", { name: "Utseende", exact: true }).click();
  await page.getByRole("radio", { name: "Glöd Mörkt", exact: true }).click();
  await expect(page.locator(".study-shell")).toHaveAttribute(
    "data-tone",
    "dark",
  );
  await audit("Inställningar · mörkt tema");
  await page.keyboard.press("Control+1");
  await expect(
    page.getByRole("heading", { name: "Dina studier", exact: true }),
  ).toBeVisible();
  await audit("Översikt · mörkt tema");

  await testInfo.attach("next-accessibility-violations.json", {
    body: JSON.stringify(violations, null, 2),
    contentType: "application/json",
  });
  expect(violations).toEqual([]);
});
