import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const nextMode = process.env.VITE_NEXT_E2E === "true";
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

// Synthetic, small assets: no real study library, microphone or paid provider is used.
function lectureTestPdf() {
  const content =
    "0.15 0.2 0.24 rg BT /F1 12 Tf 44 345 Td (LECTIO / TEST MATERIAL) Tj ET\n" +
    "BT /F1 28 Tf 44 285 Td (Njurfunktion) Tj 0 -38 Td (och vatskebalans) Tj ET\n" +
    "0.4 0.46 0.48 rg BT /F1 12 Tf 44 183 Td (1. Filtration och aterupptag) Tj 0 -30 Td (2. Reglering av kroppens vatskor) Tj 0 -30 Td (3. Samband mellan begreppen) Tj ET\n" +
    "0.8 0.84 0.83 RG 44 220 m 550 220 l S\nBT /F1 10 Tf 44 40 Td (Syntetiskt material for UI-test) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 7\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

test("föreläsningsvyn importerar material, sparar och spelar utan slidekoppling", async ({
  page,
}) => {
  test.skip(!nextMode, "Körs av test:e2e:next.");
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await expect(page.locator('[data-frontend="next"]')).toBeVisible();
  await page.keyboard.press("Control+,");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("lectio-state-v1:next")),
    )
    .not.toBeNull();
  await page.getByRole("button", { name: "20", exact: true }).click();
  const payload = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("lectio-state-v1:next")!);
    const base = {
      context: "",
      settings: {},
      createdAt: new Date().toISOString(),
    };
    stored.state = {
      ...stored.state,
      nodes: [
        {
          ...base,
          id: "c",
          parentId: null,
          type: "course",
          title: "Klinisk medicin",
        },
        {
          ...base,
          id: "m",
          parentId: "c",
          type: "module",
          title: "Njurar och urinvägar",
        },
        {
          ...base,
          id: "l",
          parentId: "m",
          type: "lecture",
          title: "Njurfunktion och vätskebalans",
        },
        {
          ...base,
          id: "l2",
          parentId: "m",
          type: "lecture",
          title: "Nästa föreläsning",
        },
      ],
      lectures: {
        l: { lectureId: "l", notes: "" },
        l2: { lectureId: "l2", notes: "" },
      },
      selectedId: "l",
      activeView: "workspace",
      segments: [
        {
          id: "s1",
          lectureId: "l",
          start: 0,
          end: 20,
          text: "Vi börjar med en översikt över njurens uppgifter. Målet är att förstå hur filtration, återupptag och utsöndring hör ihop — inte att memorera varje detalj var för sig.",
        },
        {
          id: "s2",
          lectureId: "l",
          start: 20,
          end: 50,
          text: "Titta först på helheten. När vi följer vätskans väg genom nefronet blir det lättare att sätta in de enskilda transportprocesserna i ett sammanhang.",
        },
        {
          id: "s3",
          lectureId: "l",
          start: 50,
          end: 85,
          text: "En bra repetitionsfråga är: vad händer om en av processerna förändras? Försök resonera om följderna innan du läser svaret.",
        },
        {
          id: "s4",
          lectureId: "l",
          start: 85,
          end: 100,
          text: "Slidesen sammanfattar begreppen. I anteckningarna kan du samla frågor du vill återkomma till efter föreläsningen.",
        },
      ],
      cards: [
        {
          id: "card1",
          lectureId: "l",
          type: "basic",
          front: "Vilka tre processer tar föreläsningen upp?",
          back: "Filtration, återupptag och utsöndring.",
          tags: [],
          status: "generated",
        },
      ],
      markers: [],
    };
    return { version: 1, ...stored.state };
  });
  await page.getByLabel("Välj biblioteksexport").setInputFiles({
    name: "lecture-test.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(payload)),
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Importera", exact: true })
    .click();
  await expect(
    page.getByText("Biblioteket har importerats. Du hittar det i sidofältet."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Klinisk medicin", exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  await page
    .getByRole("button", { name: "Njurar och urinvägar", exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  await page
    .getByRole("button", { name: "Njurfunktion och vätskebalans", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Njurfunktion och vätskebalans",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Välj PDF", { exact: true }).setInputFiles({
    name: "Njurfunktion – föreläsningsslides.pdf",
    mimeType: "application/pdf",
    buffer: lectureTestPdf(),
  });
  await expect(page.getByLabel("Nästa sida", { exact: true })).toBeEnabled();
  await expect(page.getByText("Öppnar PDF…", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Text på PDF-sida 1" }),
  ).toContainText("Njurfunktion");
  const pdfCanvas = page.locator("canvas.lecture-pdf-page");
  const readPdfMetrics = () =>
    pdfCanvas.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        displayRatio: bounds.width / bounds.height,
        sourceRatio: element.width / element.height,
        width: bounds.width,
      };
    });
  const fitMetrics = await readPdfMetrics();
  await page.getByLabel("Zooma in", { exact: true }).click();
  await expect
    .poll(async () => (await readPdfMetrics()).width)
    .toBeGreaterThan(fitMetrics.width);
  await expect
    .poll(async () => {
      const metrics = await readPdfMetrics();
      return Math.abs(metrics.displayRatio - metrics.sourceRatio);
    })
    .toBeLessThan(0.01);
  await page.getByLabel("Zooma ut", { exact: true }).click();
  await page.getByLabel("Zooma ut", { exact: true }).click();
  await expect
    .poll(async () => (await readPdfMetrics()).width)
    .toBeLessThan(fitMetrics.width);
  await expect
    .poll(async () => {
      const metrics = await readPdfMetrics();
      return Math.abs(metrics.displayRatio - metrics.sourceRatio);
    })
    .toBeLessThan(0.01);
  await page.getByLabel("Nästa sida", { exact: true }).click();
  await expect(page.locator("canvas.lecture-pdf-page")).toHaveAttribute(
    "aria-label",
    "Slides, sida 2",
  );
  await page.getByLabel("Föregående sida", { exact: true }).click();
  const wav = Buffer.alloc(44 + 32000 * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  await page.getByLabel("Välj ljudfiler").setInputFiles({
    name: "Föreläsning – del 1.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  await expect(
    page.getByRole("button", { name: "Spela", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Spela", exact: true }).click();
  await expect(page.locator("audio")).toHaveJSProperty("paused", false);
  await page.getByRole("button", { name: "Pausa", exact: true }).click();
  await page.getByRole("tab", { name: "Anteckningar", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Anteckningar", exact: true })
    .fill("Repetera kopplingen mellan filtration och återupptag.");
  await expect(page.getByText("Sparat lokalt", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Transkript", exact: true }).click();
  await page
    .getByRole("searchbox", { name: "Sök i transkriptet" })
    .fill("helheten");
  await expect(page.locator(".lecture-transcript-row")).toHaveCount(1);
  await expect(page.locator("mark")).toHaveText("helheten");
  await page.locator(".lecture-transcript-text").click();
  await page
    .getByLabel("Redigera avsnitt 0:20")
    .fill("En ändrad text som fortfarande ska synas i sökresultatet.");
  await page.getByRole("searchbox").click();
  await expect(page.locator(".lecture-transcript-row")).toHaveCount(1);
  await page.getByRole("searchbox").fill("");
  await page.getByRole("button", { name: /Anki-kort/ }).click();
  await page.getByRole("button", { name: "Godkänn alla", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Godkänt", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Stäng", exact: true })
    .click();
  await page.getByRole("button", { name: "Spela in", exact: true }).click();
  await expect(page.getByText("Spelar in", { exact: true })).toBeVisible();
  await page.waitForTimeout(3200); // Exercise at least one durable MediaRecorder chunk, using a fake microphone.
  await page
    .getByRole("button", { name: "Stoppa och spara", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Spela in", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Nästa föreläsning", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Börja med dina slides", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Njurfunktion och vätskebalans", exact: true })
    .click();
  await expect(page.getByLabel("Nästa sida", { exact: true })).toBeEnabled();
  await expect(page.getByText("Öppnar PDF…", { exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    const key = "lectio-state-v1:next";
    const stored = JSON.parse(localStorage.getItem(key)!);
    stored.state.settings.selectedPaletteId = "orange-dark";
    localStorage.setItem(key, JSON.stringify(stored));
  });
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Njurfunktion och vätskebalans",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".study-shell")).toHaveAttribute(
    "data-tone",
    "dark",
  );
  await expect(page.locator(".lecture-transcript-text").first()).toHaveCSS(
    "text-align",
    "left",
  );
  await page.getByRole("button", { name: /Anki-kort/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const dialogUsesThemeSurface = await page
    .getByRole("dialog")
    .evaluate((dialog) => {
      const root = getComputedStyle(document.documentElement);
      const probe = document.createElement("span");
      probe.style.color = root.getPropertyValue("--arc-raised").trim();
      document.body.append(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return getComputedStyle(dialog).backgroundColor === expected;
    });
  expect(dialogUsesThemeSurface).toBe(true);
  await page.screenshot({
    path: "test-results/next-anki-dialog-dark.png",
    animations: "disabled",
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Stäng", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/next-lecture-desktop.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 920, height: 820 });
  await page
    .getByRole("button", { name: "Transkript & anteckningar", exact: true })
    .click();
  await expect(page.locator(".lecture-text-pane")).toBeVisible();
  await expect(page.locator(".lecture-material")).toBeHidden();
  await page.screenshot({
    path: "test-results/next-lecture-narrow.png",
    animations: "disabled",
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Transkript & anteckningar", exact: true })
    .click();
  await page.getByRole("tab", { name: "Anteckningar", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Anteckningar", exact: true }),
  ).toHaveValue("Repetera kopplingen mellan filtration och återupptag.");
  expect(errors).toEqual([]);
});

test("nya inställningar importerar, exporterar och återställer isolerat", async ({
  page,
}) => {
  test.skip(!nextMode, "Körs av test:e2e:next.");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await expect(page.locator('[data-frontend="next"]')).toBeVisible();
  await page.keyboard.press("Control+,");
  await expect(
    page.getByRole("heading", { name: "Bibliotek och data", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("lectio-state-v1:next")),
    )
    .not.toBeNull();
  for (const category of [
    "Utseende",
    "Ljud och inspelning",
    "Transkribering",
    "AI och Anki",
    "Synk och anslutningar",
  ]) {
    await page.getByRole("button", { name: category, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: category, exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "Utseende", exact: true }).click();
  await expect(page.getByRole("radio")).toHaveCount(4);
  await page.getByRole("radio", { name: /Glöd/ }).click();
  await expect(page.locator(".study-shell")).toHaveAttribute(
    "data-tone",
    "dark",
  );
  await expect(page.locator(".study-sidebar")).toHaveCSS(
    "color",
    "rgb(255, 255, 255)",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("lectio-state-v1:next")!).state
            .settings.selectedPaletteId,
      ),
    )
    .toBe("orange-dark");
  await page.screenshot({ path: "test-results/next-settings-themes-dark.png" });
  await page.getByRole("radio", { name: /Himmel/ }).click();
  await expect(page.locator(".study-shell")).toHaveAttribute(
    "data-tone",
    "light",
  );
  await page
    .getByRole("button", { name: "Ljud och inspelning", exact: true })
    .click();
  await page.getByRole("button", { name: "Hög", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Hög", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Bibliotek och data", exact: true })
    .click();
  await page.getByRole("button", { name: "20", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "20", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const search = page.getByRole("searchbox", { name: "Sök inställningar" });
  await search.fill("zzzz");
  await expect(page.getByText("Inga matchande inställningar")).toBeVisible();
  await search.fill("");
  const before = await page.evaluate(
    () => JSON.parse(localStorage.getItem("lectio-state-v1:next")!).state,
  );
  await page.getByLabel("Välj biblioteksexport").setInputFiles({
    name: "trasig.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":1}'),
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Importera", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Biblioteket kunde inte importeras.",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("lectio-state-v1:next")!).state.nodes,
      ),
    )
    .toEqual(before.nodes);
  const payload = {
    version: 1,
    nodes: [
      {
        id: "import-course",
        parentId: null,
        type: "course",
        title: "Mitt importerade bibliotek",
        context: "",
        settings: {},
        createdAt: new Date().toISOString(),
      },
    ],
    lectures: {},
    segments: [],
    markers: [],
    cards: [],
    settings: { backupLimit: 5 },
  };
  await page.getByLabel("Välj biblioteksexport").setInputFiles({
    name: "bibliotek.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(payload)),
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Importera", exact: true })
    .click();
  await expect(
    page.getByText("Biblioteket har importerats. Du hittar det i sidofältet."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Mitt importerade bibliotek",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "20", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportera", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/lectio-export-.*\.zip/);
  await expect(
    page.getByText("ZIP-exporten har skickats till dina nedladdningar."),
  ).toBeVisible();
  await page.getByLabel("Välj biblioteksexport").setInputFiles({
    name: download.suggestedFilename(),
    mimeType: "application/zip",
    buffer: await readFile((await download.path())!),
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Importera", exact: true })
    .click();
  await expect(
    page.getByText("Biblioteket har importerats. Du hittar det i sidofältet."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /sparade återställningspunkter/ })
    .click();
  await page
    .getByRole("button", { name: "Återställ", exact: true })
    .last()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Återställ", exact: true })
    .click();
  await expect(page.getByText("Biblioteket har återställts.")).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("lectio-state-v1")),
  ).toBeNull();
  await page.getByRole("button", { name: "Stäng meddelandet" }).click();
  await page.locator(".study-settings-scroll").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: "test-results/next-settings-desktop.png" });
  await page.getByRole("button", { name: "Dölj sidofält" }).click();
  await expect(page.locator(".study-sidebar")).toHaveCSS("width", "68px");
  await page.screenshot({ path: "test-results/next-settings-collapsed.png" });
  await page.getByRole("button", { name: "Hjälp och kortkommandon" }).click();
  await expect(
    page.getByRole("heading", { name: "Kortkommandon", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(180);
  await page.screenshot({
    path: "test-results/next-settings-help-collapsed.png",
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Bibliotek", exact: true }).click();
  await expect(page.locator(".study-library-flyout")).toBeVisible();
  await page.waitForTimeout(180);
  await page.screenshot({
    path: "test-results/next-settings-library-collapsed.png",
  });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 760, height: 800 });
  await expect(
    page.getByRole("heading", { name: "Bibliotek och data", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/next-settings-narrow.png" });
  expect(errors).toEqual([]);
});

test("Next använder kontraktet och en isolerad persistent profil", async ({
  page,
}) => {
  test.skip(!nextMode, "Körs av test:e2e:next.");
  await page.goto("/");
  await expect(page.locator('[data-frontend="next"]')).toBeVisible();
  await expect(page.getByLabel("Fönsterkontroller")).toBeVisible();
  await expect(page.getByText("Super Actions", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Skapa kurs" }).click();
  await page
    .getByRole("textbox", { name: "Namn", exact: true })
    .fill("Medicin");
  await page.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Medicin", exact: true }),
  ).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() => ({
        next: Boolean(localStorage.getItem("lectio-state-v1:next")),
        main: Boolean(localStorage.getItem("lectio-state-v1")),
      })),
    )
    .toEqual({ next: true, main: false });

  await page.reload();
  await expect(
    page.getByRole("button", { name: "Medicin", exact: true }),
  ).toBeVisible();
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

test("sidofältets hierarki, sökning och avbrytbara kollaps fungerar", async ({
  page,
}) => {
  test.skip(!nextMode, "Körs av test:e2e:next.");
  const errors: string[] = [];
  const settle = () =>
    page.evaluate(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      await Promise.all(
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect?.getTiming().iterations !== Infinity,
          )
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const name = page.getByRole("textbox", { name: "Namn", exact: true });
  await page.getByRole("button", { name: "Skapa kurs", exact: true }).click();
  await name.fill("Klinisk medicin");
  await name.press("Enter");
  await page
    .getByRole("button", {
      name: "Alternativ för Klinisk medicin",
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: "Ny modul", exact: true }).click();
  await name.fill("Urologi");
  await name.press("Enter");
  await page
    .getByRole("button", { name: "Alternativ för Urologi", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Ny föreläsning", exact: true })
    .click();
  await name.fill("Prostatacancer – diagnostik och behandling");
  await name.press("Enter");
  const lecture = page.getByRole("button", {
    name: "Prostatacancer – diagnostik och behandling",
    exact: true,
  });
  await expect(lecture).toHaveAttribute("aria-current", "page");
  await page
    .getByRole("button", {
      name: "Alternativ för Klinisk medicin",
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: "Ny modul", exact: true }).click();
  await name.fill("Akutmedicin");
  await name.press("Enter");
  const destination = page.locator(".study-tree-row").filter({
    has: page.getByRole("button", { name: "Akutmedicin", exact: true }),
  });
  await lecture.dragTo(destination);
  await expect(
    destination.locator("..").getByRole("button", {
      name: "Prostatacancer – diagnostik och behandling",
      exact: true,
    }),
  ).toBeVisible();
  await lecture.click();
  await page
    .getByRole("button", { name: "Sök i biblioteket", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Sök i biblioteket" })
    .fill("prostata");
  await expect(lecture).toBeVisible();
  await page
    .getByRole("textbox", { name: "Sök i biblioteket" })
    .press("Escape");
  await page
    .getByRole("button", { name: "Dölj sidofält", exact: true })
    .focus();
  await page.keyboard.press("Control+b");
  await page.keyboard.press("Control+b");
  await page.keyboard.press("Control+b");
  await expect(page.locator(".study-sidebar")).toHaveCSS("width", "68px");
  await page.keyboard.press("Control+4");
  await expect(
    page.getByRole("button", { name: "Inkorg", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const inboxButton = page.getByRole("button", {
    name: "Inkorg",
    exact: true,
  });
  await inboxButton.hover();
  const tooltip = page.locator(".study-tooltip");
  await expect(tooltip).toBeVisible();
  const tooltipBox = await tooltip.boundingBox();
  expect(tooltipBox).not.toBeNull();
  await page.mouse.move(
    tooltipBox!.x + tooltipBox!.width / 2,
    tooltipBox!.y + tooltipBox!.height / 2,
  );
  await expect(tooltip).toBeHidden();
  await page.getByRole("button", { name: "Bibliotek", exact: true }).click();
  await expect(lecture).toBeVisible();
  await expect(page.locator(".study-tooltip")).toHaveCount(0);
  await lecture.click();
  await expect(
    page.getByRole("heading", {
      name: "Prostatacancer – diagnostik och behandling",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".study-library-flyout")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Inkorg", exact: true }),
  ).not.toHaveAttribute("aria-current", "page");
  await settle();
  await page.screenshot({ path: "test-results/next-sidebar-collapsed.png" });
  await page.keyboard.press("Control+b");
  await expect(page.locator(".study-sidebar")).toHaveCSS("width", "272px");
  await settle();
  await page.screenshot({ path: "test-results/next-sidebar-desktop.png" });
  await page.setViewportSize({ width: 860, height: 600 });
  await expect(page.locator(".study-sidebar")).toHaveCSS("width", "272px");
  await settle();
  await page.screenshot({ path: "test-results/next-sidebar-narrow.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle();
  await page.screenshot({ path: "test-results/next-sidebar-dark.png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Control+b");
  await expect(page.locator(".study-sidebar")).toHaveCSS("width", "68px");
  await page.getByRole("button", { name: "Bibliotek", exact: true }).click();
  await expect(
    page.locator(".study-library-flyout .study-tree-branch").first(),
  ).toHaveCSS("transition-duration", "0s");
  await expect(
    page.locator(".study-library-flyout .next-tree-row-selected"),
  ).not.toHaveCSS("box-shadow", "none");
  await settle();
  await page.screenshot({ path: "test-results/next-sidebar-flyout.png" });
  expect(errors).toEqual([]);
});
