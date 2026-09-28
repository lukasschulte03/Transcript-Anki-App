import { expect, test, type Locator } from "@playwright/test";
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

test("startskärmen använder sparad palett och tonar över till arbetsytan", async ({
  page,
}) => {
  test.skip(!nextMode, "Körs av test:e2e:next.");
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() =>
    localStorage.setItem("lectio-startup-palette:next", "blue-light"),
  );
  await page.goto("/");
  await expect(page.locator('[data-frontend="next"]')).toBeVisible({
    timeout: 3_000,
  });
  await expect(page.locator("#lectio-startup")).toBeHidden();
  await expect(page.locator(".study-shell")).toHaveCSS("opacity", "1");
  await expect(page.locator("html")).toHaveAttribute(
    "data-lectio-startup-palette",
    "blue-light",
  );

  await page.evaluate(() => {
    const key = "lectio-state-v1:next";
    const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
    const now = new Date().toISOString();
    stored.state = {
      ...stored.state,
      nodes: [
        {
          id: "large-course",
          parentId: null,
          type: "course",
          title: "Stort prestandatest",
          context: "",
          settings: {},
          createdAt: now,
        },
        {
          id: "large-lecture",
          parentId: "large-course",
          type: "lecture",
          title: "Långt transkript",
          context: "",
          settings: {},
          createdAt: now,
        },
      ],
      lectures: { "large-lecture": { lectureId: "large-lecture", notes: "" } },
      segments: Array.from({ length: 5_000 }, (_, index) => ({
        id: `large-segment-${index}`,
        lectureId: "large-lecture",
        start: index * 5,
        end: index * 5 + 5,
        text: `Klinisk föreläsningstext ${index}`,
      })),
      cards: [],
      markers: [],
      activeView: "dashboard",
    };
    localStorage.setItem(key, JSON.stringify(stored));
  });
  const hydrationStartedAt = Date.now();
  await page.reload();
  await expect(
    page.locator(".overview-metrics article").nth(2).locator("strong"),
  ).toHaveText("1", { timeout: 3_000 });
  expect(Date.now() - hydrationStartedAt).toBeLessThan(3_000);
});

test("föreläsningsvyn importerar material, sparar och spelar utan slidekoppling", async ({
  page,
}) => {
  test.skip(!nextMode, "Körs av test:e2e:next.");
  test.setTimeout(90_000);
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
          end: 21,
          text: "Titta först på helheten. När vi följer vätskans väg genom nefronet blir det lättare att sätta in de enskilda transportprocesserna i ett sammanhang.",
        },
        ...Array.from({ length: 18 }, (_, index) => ({
          id: `s${index + 3}`,
          lectureId: "l",
          start: 21 + index,
          end: 22 + index,
          text: `Fortsatt syntetiskt transkriptsegment ${index + 3} för scrollföljning.`,
        })),
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
  await page.keyboard.press("PageDown");
  await expect(page.locator("canvas.lecture-pdf-page")).toHaveAttribute(
    "aria-label",
    "Slides, sida 2 av 2",
  );
  await page.keyboard.press("Home");
  await expect(page.locator("canvas.lecture-pdf-page")).toHaveAttribute(
    "aria-label",
    "Slides, sida 1 av 2",
  );
  await page.getByRole("button", { name: /^Bilder/ }).click();
  const imagesDialog = page.getByRole("dialog", { name: "Slidebilder" });
  await expect(imagesDialog.getByText("Inga bilder extraherade")).toBeVisible();
  await expect(imagesDialog.getByText("Extraherar bilder")).toHaveCount(0);
  const imageDialogSurface = await imagesDialog.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderRadius: style.borderRadius,
      backgroundColor: style.backgroundColor,
      textAlign: style.textAlign,
    };
  });
  expect(imageDialogSurface).toEqual({
    borderRadius: "8px",
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    textAlign: "left",
  });
  await imagesDialog.getByRole("button", { name: "Stäng" }).click();
  await page.getByRole("button", { name: "Dela sammansatta slides" }).click();
  const splitDialog = page.getByRole("dialog");
  await expect(splitDialog).toBeVisible();
  await expect(
    splitDialog.getByText("Välj rutnät för att visa beskärningen"),
  ).toBeVisible();
  await expect
    .poll(() =>
      splitDialog.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          borderRadius: style.borderRadius,
          backgroundColor: style.backgroundColor,
          textAlign: style.textAlign,
        };
      }),
    )
    .toEqual(imageDialogSurface);
  const splitButton = splitDialog.getByRole("button", {
    name: "Dela alla sidor",
  });
  await expect(splitButton).toBeDisabled();
  await splitDialog
    .getByRole("button", { name: "2 rader, 2 kolumner" })
    .click();
  await expect(
    splitDialog.getByText(/Alla PDF-sidor delas i 4 delar/),
  ).toBeVisible();
  const regions = splitDialog.locator(".lecture-split-region");
  const originalFirstRegionStyle = await regions.nth(0).getAttribute("style");
  const firstResizeHandle = splitDialog
    .locator(".lecture-split-resize-right")
    .first();
  const resizeBounds = await firstResizeHandle.boundingBox();
  const previewBounds = await splitDialog
    .locator(".lecture-split-preview")
    .boundingBox();
  expect(resizeBounds).not.toBeNull();
  expect(previewBounds).not.toBeNull();
  const dragHandle = async (xDelta: number, yDelta = 0) => {
    const bounds = await splitDialog
      .locator(".lecture-split-resize-right")
      .first()
      .boundingBox();
    expect(bounds).not.toBeNull();
    const centerX = bounds!.x + bounds!.width / 2;
    const centerY = bounds!.y + bounds!.height / 2;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + xDelta, centerY + yDelta, { steps: 4 });
    await page.mouse.up();
  };
  await dragHandle(24);
  await expect
    .poll(() =>
      regions
        .nth(0)
        .evaluate((element) => (element as HTMLElement).style.width),
    )
    .not.toBe("50%");
  const resizedWidths = await regions.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).style.width),
  );
  expect(new Set(resizedWidths).size).toBe(1);

  await page.keyboard.down("Shift");
  await dragHandle(12);
  await page.keyboard.up("Shift");
  const shiftedRatios = await regions.evaluateAll((elements) =>
    elements.map((element) => {
      const region = element as HTMLElement;
      return parseFloat(region.style.width) / parseFloat(region.style.height);
    }),
  );
  for (const ratio of shiftedRatios) expect(ratio).toBeCloseTo(1.08, 1);

  const centerBeforeCtrl = await regions.nth(0).evaluate((element) => {
    const region = element as HTMLElement;
    return parseFloat(region.style.left) + parseFloat(region.style.width) / 2;
  });
  await page.keyboard.down("Control");
  await dragHandle(-10);
  await page.keyboard.up("Control");
  const centerAfterCtrl = await regions.nth(0).evaluate((element) => {
    const region = element as HTMLElement;
    return parseFloat(region.style.left) + parseFloat(region.style.width) / 2;
  });
  expect(centerAfterCtrl).toBeCloseTo(centerBeforeCtrl, 2);

  const moveBounds = await regions
    .nth(0)
    .getByRole("button", { name: /Välj och flytta ruta 1/ })
    .boundingBox();
  expect(moveBounds).not.toBeNull();
  await page.mouse.move(
    moveBounds!.x + moveBounds!.width / 2,
    moveBounds!.y + moveBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    moveBounds!.x + moveBounds!.width / 2 + 12,
    moveBounds!.y + moveBounds!.height / 2 + 8,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect
    .poll(() =>
      regions.nth(0).evaluate((element) => (element as HTMLElement).style.left),
    )
    .not.toBe("0%");
  await splitDialog.getByRole("button", { name: "2 rader, 1 kolumn" }).click();
  const standardTwoByOne = await regions.evaluateAll((elements) =>
    elements.map((element) => {
      const region = element as HTMLElement;
      return {
        left: region.style.left,
        top: region.style.top,
        width: region.style.width,
        height: region.style.height,
      };
    }),
  );
  expect(standardTwoByOne).toEqual([
    { left: "0%", top: "0%", width: "100%", height: "50%" },
    { left: "0%", top: "50%", width: "100%", height: "50%" },
  ]);
  const fittedButton = splitDialog.getByRole("button", {
    name: "Anpassa till innehåll",
  });
  if (await fittedButton.isEnabled()) {
    await fittedButton.click();
    await splitDialog
      .getByRole("button", { name: "Standardbeskärning" })
      .click();
    const restoredGeometry = await regions.evaluateAll((elements) =>
      elements.map((element) => (element as HTMLElement).style.top),
    );
    expect(restoredGeometry).toEqual(["0%", "50%"]);
  }
  await splitDialog
    .getByRole("button", { name: "1 rader, 2 kolumner" })
    .click();
  await splitDialog
    .getByRole("button", { name: "2 rader, 2 kolumner" })
    .click();
  await expect(regions.nth(0)).toHaveAttribute(
    "style",
    originalFirstRegionStyle ?? "",
  );
  await splitDialog.getByRole("button", { name: "Ta bort ruta 4" }).click();
  await expect(
    splitDialog.getByText(/Alla PDF-sidor delas i 3 delar/),
  ).toBeVisible();
  await splitDialog.getByRole("button", { name: "Ta med ruta 4" }).click();
  await splitDialog
    .getByRole("button", { name: "1 rader, 2 kolumner" })
    .click();
  await expect(
    splitDialog.getByText("Alla PDF-sidor delas i 2 delar"),
  ).toBeVisible();
  await expect(splitButton).toBeEnabled();
  await splitButton.click();
  await expect(page.locator(".lecture-pdf-tools")).toContainText("1 / 4");
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Njurfunktion och vätskebalans",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".lecture-pdf-tools")).toContainText("1 / 4");
  await page.getByLabel("Nästa sida", { exact: true }).click();
  await expect(page.locator(".lecture-pdf-tools")).toContainText("2 / 4");
  await page.getByLabel("Nästa sida", { exact: true }).click();
  await expect(page.locator(".lecture-pdf-tools")).toContainText("3 / 4");
  await page.getByLabel("Föregående sida", { exact: true }).click();
  await page.getByLabel("Föregående sida", { exact: true }).click();
  await expect(page.locator(".lecture-pdf-tools")).toContainText("1 / 4");
  await page
    .getByRole("button", { name: "Återställ alla", exact: true })
    .click();
  await expect(page.locator(".lecture-pdf-tools")).toContainText("1 / 2");
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
    "Slides, sida 2 av 2",
  );
  await page.getByLabel("Föregående sida", { exact: true }).click();
  const wav = Buffer.alloc(44 + 16000 * 40 * 2);
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
  const timeline = page.getByRole("slider", { name: "Ljudposition" });
  await timeline.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => page.locator("audio").evaluate((audio) => audio.currentTime))
    .toBeGreaterThan(9.5);
  await page.keyboard.press("Shift+ArrowLeft");
  await expect
    .poll(() => page.locator("audio").evaluate((audio) => audio.currentTime))
    .toBeLessThan(0.2);
  await page.keyboard.press("Space");
  await expect(page.locator("audio")).toHaveJSProperty("paused", false);
  await expect(page.locator("#lecture-transcript-s1")).toHaveAttribute(
    "data-audio-active",
    "true",
  );
  await page.keyboard.press("Space");
  await expect(page.locator("audio")).toHaveJSProperty("paused", true);
  const activeTranscriptRow = page.locator("#lecture-transcript-s7");
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = 25;
    audio.dispatchEvent(new Event("timeupdate"));
  });
  await expect(activeTranscriptRow).toHaveAttribute(
    "data-audio-active",
    "true",
  );
  const distanceFromTranscriptCenter = () =>
    activeTranscriptRow.evaluate((row) => {
      const container = row.closest(".lecture-transcript-scroll")!;
      const rowRect = row.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      return Math.abs(
        rowRect.top +
          rowRect.height / 2 -
          (containerRect.top + container.clientHeight / 2),
      );
    });
  await expect.poll(distanceFromTranscriptCenter).toBeLessThan(32);
  const transcriptScroll = page.locator(".lecture-transcript-scroll");
  await transcriptScroll.hover();
  await page.mouse.wheel(0, 380);
  const resumeFollowing = page.getByRole("button", {
    name: "Återuppta följning av transkriptet",
  });
  await expect(resumeFollowing).toBeVisible();
  await expect.poll(distanceFromTranscriptCenter).toBeGreaterThan(80);
  await resumeFollowing.click();
  await expect.poll(distanceFromTranscriptCenter).toBeLessThan(32);
  await page.getByRole("tab", { name: "Anteckningar", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Anteckningar", exact: true })
    .fill("Repetera kopplingen mellan filtration och återupptag.");
  await expect(page.getByText("Sparat lokalt", { exact: true })).toBeVisible();
  await page.keyboard.press("Control+f");
  await expect(
    page.getByRole("searchbox", { name: "Sök i transkriptet" }),
  ).toBeFocused();
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
  await page
    .getByRole("heading", {
      name: "Njurfunktion och vätskebalans",
      exact: true,
    })
    .click();
  await page.keyboard.press("Control+Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Godkänn alla", exact: true }).click();
  await expect(page.getByRole("button", { name: /godkänt/i })).toBeDisabled();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Stäng", exact: true })
    .click();
  await page.keyboard.press("r");
  await expect(page.getByText("Spelar in", { exact: true })).toBeVisible();
  await page.keyboard.press("p");
  await expect(page.getByText("Pausad", { exact: true })).toBeVisible();
  await page.keyboard.press("p");
  await expect(page.getByText("Spelar in", { exact: true })).toBeVisible();
  await page.waitForTimeout(3200); // Exercise at least one durable MediaRecorder chunk, using a fake microphone.
  await page.keyboard.press("r");
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
      probe.style.color = root.getPropertyValue("--arc-overlay-strong").trim();
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
  const persistedLectureData = await page.evaluate(() => {
    const state = JSON.parse(
      localStorage.getItem("lectio-state-v1:next") ?? "{}",
    ).state;
    return {
      audioNames: state.lectures.l.audioParts?.map(
        (part: { name: string }) => part.name,
      ),
      transcriptCount: state.segments.filter(
        (segment: { lectureId: string }) => segment.lectureId === "l",
      ).length,
      approvedCard: state.cards.find(
        (card: { id: string }) => card.id === "card1",
      )?.status,
      notes: state.lectures.l.notes,
    };
  });
  expect(persistedLectureData.audioNames).toContain("Föreläsning – del 1.wav");
  expect(persistedLectureData.transcriptCount).toBe(20);
  expect(persistedLectureData.approvedCard).toBe("approved");
  expect(persistedLectureData.notes).toBe(
    "Repetera kopplingen mellan filtration och återupptag.",
  );
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
    "Allmänt",
    "Utseende",
    "Ljud och inspelning",
    "Transkribering",
    "OCR och bildanalys",
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
  const hasAmbientCanvas = await page.evaluate(() => {
    const canvas = document.querySelector(
      ".study-grainient canvas",
    ) as HTMLCanvasElement | null;
    if (canvas)
      (
        window as Window & { __lectioInitialAmbient?: HTMLCanvasElement }
      ).__lectioInitialAmbient = canvas;
    return Boolean(canvas);
  });
  await page.getByRole("radio", { name: /Glöd/ }).click();
  await expect(page.locator(".study-shell")).toHaveAttribute(
    "data-tone",
    "dark",
  );
  if (hasAmbientCanvas) {
    expect(
      await page.evaluate(
        () =>
          (window as Window & { __lectioInitialAmbient?: HTMLCanvasElement })
            .__lectioInitialAmbient ===
          document.querySelector(".study-grainient canvas"),
      ),
    ).toBe(true);
  }
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
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("lectio-startup-palette:next")),
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
  await search.fill("grafikkort");
  const accelerationResult = page.getByRole("button", {
    name: /Acceleration Transkribering/,
  });
  await expect(accelerationResult).toBeVisible();
  await accelerationResult.click();
  await expect(
    page.getByRole("heading", { name: "Transkribering", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#transcription-acceleration")).toBeVisible();
  await search.fill("transkibering");
  const transcriptionResult = page.getByRole("button", {
    name: /Transkriptionsmotor Transkribering/,
  });
  await expect(transcriptionResult).toBeVisible();
  await transcriptionResult.click();
  await expect(page.locator("#transcription-method")).toBeVisible();
  await search.fill("openai key");
  const aiKeyResult = page
    .locator("#study-settings-search-results")
    .getByRole("button", { name: /API-nyckel för AI/ });
  await expect(aiKeyResult).toBeVisible();
  await aiKeyResult.click();
  await expect(page.locator("#generation-method")).toBeVisible();
  await search.fill("zzzz");
  await expect(page.getByText("Inga matchande inställningar")).toBeVisible();
  await search.fill("");
  await page
    .getByRole("button", { name: "Bibliotek och data", exact: true })
    .click();
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
  await expect(
    page.getByRole("region", { name: "Inställningar" }).getByRole("alert"),
  ).toContainText("Biblioteket kunde inte importeras.");
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
  test.setTimeout(90_000);
  const dragWithPointer = async (
    source: Locator,
    target: Locator,
    targetPosition = { x: 16, y: 14 },
  ) => {
    // The tree is independently scrollable; mouse coordinates do not trigger
    // Playwright's automatic scrolling, so explicitly reveal both endpoints.
    await source.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();
    await source.scrollIntoViewIfNeeded();
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    const startX = sourceBox!.x + sourceBox!.width / 2;
    const startY = sourceBox!.y + sourceBox!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 8, startY + 4, { steps: 2 });
    await page.mouse.move(
      targetBox!.x + targetPosition.x,
      targetBox!.y + targetPosition.y,
      { steps: 12 },
    );
    await page.mouse.up();
  };
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
  const clinicalCourse = page.locator(".study-tree-row").filter({
    has: page.getByRole("button", {
      name: "Klinisk medicin",
      exact: true,
    }),
  });
  await dragWithPointer(lecture, destination);
  await expect(
    destination.locator("..").getByRole("button", {
      name: "Prostatacancer – diagnostik och behandling",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".study-sidebar-notice")).toContainText(
    "flyttades till Akutmedicin",
  );
  await dragWithPointer(lecture, clinicalCourse);
  // A course is not a valid direct parent for a lecture. Verify the tree is
  // unchanged instead of relying on a transient notice from the pointer drag.
  await expect(
    destination.locator("..").getByRole("button", {
      name: "Prostatacancer – diagnostik och behandling",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Alternativ för Prostatacancer – diagnostik och behandling",
      exact: true,
    })
    .focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Flytta till" }).focus();
  await page.keyboard.press("ArrowRight");
  await page
    .getByRole("menuitem", { name: "Urologi", exact: true })
    .press("Enter");
  await expect(
    page
      .locator(".study-tree-row")
      .filter({
        has: page.getByRole("button", { name: "Urologi", exact: true }),
      })
      .locator("..")
      .getByRole("button", {
        name: "Prostatacancer – diagnostik och behandling",
        exact: true,
      }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Alternativ för Urologi",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: "Ny föreläsning", exact: true })
    .click();
  await name.fill("Urologisk diagnostik");
  await name.press("Enter");
  const urologyLecture = page.getByRole("button", {
    name: "Urologisk diagnostik",
    exact: true,
  });
  await dragWithPointer(lecture, urologyLecture.locator(".."), {
    x: 12,
    y: 2,
  });
  await expect(page.locator(".study-sidebar-notice")).toContainText(
    "placerades före Urologisk diagnostik",
  );
  const urologySiblingOrder = await page
    .locator('.study-tree-row[data-depth="2"] .study-tree-select span')
    .allTextContents();
  expect(
    urologySiblingOrder.indexOf("Prostatacancer – diagnostik och behandling"),
  ).toBeLessThan(urologySiblingOrder.indexOf("Urologisk diagnostik"));
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

  // Cross-parent movement works for modules too, not only leaf lectures.
  await page.getByRole("button", { name: "Skapa kurs", exact: true }).click();
  await name.fill("Kardiologi");
  await name.press("Enter");
  await page
    .getByRole("button", { name: "Alternativ för Kardiologi", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Ny modul", exact: true }).click();
  await name.fill("Hjärtsjukdomar");
  await name.press("Enter");
  const cardiology = page.locator(".study-tree-row").filter({
    has: page.getByRole("button", { name: "Kardiologi", exact: true }),
  });
  await dragWithPointer(
    page
      .locator(".study-sidebar")
      .getByRole("button", { name: "Kardiologi", exact: true }),
    clinicalCourse,
    { x: 12, y: 2 },
  );
  const courseOrder = await page
    .locator('.study-tree-row[data-depth="0"] .study-tree-select span')
    .allTextContents();
  expect(courseOrder.indexOf("Kardiologi")).toBeLessThan(
    courseOrder.indexOf("Klinisk medicin"),
  );
  const urologyModule = page
    .locator(".study-sidebar")
    .getByRole("button", { name: "Urologi", exact: true });
  await dragWithPointer(urologyModule, cardiology);
  await expect(
    cardiology
      .locator("..")
      .getByRole("button", { name: "Urologi", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".study-sidebar-notice")).toContainText(
    "flyttades till Kardiologi",
  );
  await dragWithPointer(
    urologyModule,
    page.locator(".study-tree-row").filter({
      has: page.getByRole("button", { name: "Hjärtsjukdomar", exact: true }),
    }),
    { x: 12, y: 2 },
  );
  const moduleOrder = await page
    .locator('.study-tree-row[data-depth="1"] .study-tree-select span')
    .allTextContents();
  expect(moduleOrder.indexOf("Urologi")).toBeLessThan(
    moduleOrder.indexOf("Hjärtsjukdomar"),
  );

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
  await expect(
    page.getByRole("heading", {
      name: "Koppla din Google Drive-inkorg",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Öppna synkinställningar",
      exact: true,
    }),
  ).toBeVisible();
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
  await page.keyboard.press("Control+1");
  await expect(
    page.getByRole("heading", { name: "Dina studier", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+5");
  await expect(
    page.getByRole("heading", { name: "Superåtgärder", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Välj alla/ }).click();
  await expect(
    page.getByRole("button", { name: "Starta transkribering nu", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("0 valda", { exact: true })).toBeVisible();
  await lecture.click();
  await settle();
  await page.screenshot({ path: "test-results/next-sidebar-desktop.png" });
  await page.setViewportSize({ width: 860, height: 600 });
  await expect(page.locator(".study-sidebar")).toHaveCSS("width", "232px");
  await settle();
  await page.screenshot({ path: "test-results/next-sidebar-narrow.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 760, height: 680 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    const key = "lectio-state-v1:next";
    const stored = JSON.parse(localStorage.getItem(key)!);
    stored.state.settings.selectedPaletteId = "blue-dark";
    localStorage.setItem(key, JSON.stringify(stored));
  });
  await page.reload();
  await expect(page.locator(".study-shell")).toHaveAttribute(
    "data-theme",
    "blue-dark",
  );
  await expect(page.locator(".study-shell")).toHaveAttribute(
    "data-tone",
    "dark",
  );
  const darkPaletteBridge = await page
    .locator(".study-shell")
    .evaluate((shell) => {
      const style = getComputedStyle(shell);
      return {
        softSurface: style.getPropertyValue("--arc-soft").trim(),
        dangerForeground: style
          .getPropertyValue("--palette-danger-foreground")
          .trim(),
      };
    });
  expect(darkPaletteBridge.softSurface).not.toBe("");
  expect(darkPaletteBridge.dangerForeground).not.toBe("");
  await settle();
  await page.screenshot({ path: "test-results/next-sidebar-dark.png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Control+b");
  await expect(page.locator(".study-sidebar")).toHaveCSS("width", "68px");
  await page.getByRole("button", { name: "Bibliotek", exact: true }).click();
  await expect(
    page.locator(".study-library-flyout .study-tree-branch").first(),
  ).toHaveCSS("transition-property", "opacity");
  await expect(
    page.locator(".study-library-flyout .study-tree-branch").first(),
  ).toHaveCSS("transition-duration", "0.08s");
  await expect(
    page.locator(".study-library-flyout .next-tree-row-selected"),
  ).not.toHaveCSS("box-shadow", "none");
  await settle();
  await page.screenshot({ path: "test-results/next-sidebar-flyout.png" });
  expect(errors).toEqual([]);
});

test("kollapsad sidebar har en jämn biblioteksknapp och vänsterställd popup", async ({
  page,
}) => {
  test.skip(!nextMode, "Körs av test:e2e:next.");
  await page.goto("/");
  await expect(page.locator('[data-frontend="next"]')).toBeVisible();
  await page
    .getByRole("button", { name: "Dölj sidofält", exact: true })
    .click();
  await expect(page.locator(".study-sidebar")).toHaveCSS("width", "68px");

  const destinations = page.locator(".study-destinations .study-destination");
  const lastDestination = await destinations.last().boundingBox();
  const libraryButton = page.getByRole("button", {
    name: "Bibliotek",
    exact: true,
  });
  const libraryBox = await libraryButton.boundingBox();
  const sidebarBox = await page.locator(".study-sidebar").boundingBox();
  const navigationBox = await page.locator(".study-destinations").boundingBox();
  const footerBox = await page.locator(".study-sidebar-footer").boundingBox();
  expect(lastDestination).not.toBeNull();
  expect(libraryBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  expect(navigationBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(libraryBox!.width).toBeCloseTo(lastDestination!.width, 1);
  expect(libraryBox!.height).toBeCloseTo(lastDestination!.height, 1);
  const gapCenter =
    (navigationBox!.y + navigationBox!.height + footerBox!.y) / 2;
  expect(
    Math.abs(libraryBox!.y + libraryBox!.height / 2 - gapCenter),
  ).toBeLessThan(3);
  expect(
    Math.abs(
      libraryBox!.x +
        libraryBox!.width / 2 -
        (sidebarBox!.x + sidebarBox!.width / 2),
    ),
  ).toBeLessThan(1);
  await expect(page.locator(".study-rail-library button button")).toHaveCount(
    0,
  );

  await libraryButton.click();
  await expect(page.locator(".study-library-flyout")).toBeVisible();
  await expect(page.locator(".study-library-flyout")).toHaveCSS(
    "text-align",
    "left",
  );
  await expect(page.locator(".study-library-flyout")).toHaveCSS(
    "border-radius",
    "8px",
  );
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "?", bubbles: true }),
    ),
  );
  const shortcuts = page.locator(".study-help");
  await expect(shortcuts).toBeVisible();
  await expect(shortcuts).toHaveCSS("text-align", "left");
  await expect(shortcuts).toHaveCSS("border-radius", "8px");
  await expect(shortcuts).toContainText("Mellanslag");
  await expect(shortcuts).toContainText("Ctrl + Enter");
  await expect(shortcuts).toContainText("Page Up / Down");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+4");
  await expect(page.locator(".study-canvas")).toHaveAttribute(
    "data-view",
    "inbox",
  );
  await page.keyboard.press("Control+5");
  await expect(page.locator(".study-canvas")).toHaveAttribute(
    "data-view",
    "super-actions",
  );
  await page.keyboard.press("Control+1");
  await expect(page.locator(".study-canvas")).toHaveAttribute(
    "data-view",
    "dashboard",
  );
});
