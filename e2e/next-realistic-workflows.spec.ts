import { test, expect } from "./qa-fixtures";
import type { Page } from "@playwright/test";

const nextMode = process.env.VITE_NEXT_E2E === "true";
const stateKey = "lectio-state-v1:next";

async function seedLongSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-frontend="next"]')).toBeVisible();
  // The shell paints before deferred persistence hydrates. Wait for that read
  // to finish before installing a fixture, otherwise the initial empty state
  // can win the reload race and overwrite the seeded snapshot.
  await page.waitForTimeout(350);
  await page.evaluate((key) => {
    const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
    const createdAt = "2026-01-01T00:00:00.000Z";
    const node = (
      id: string,
      parentId: string | null,
      type: string,
      title: string,
      sortIndex = 0,
    ) => ({
      id,
      parentId,
      type,
      title,
      sortIndex,
      context: "",
      createdAt,
      settings: {},
    });
    const nodes = [node("workspace", null, "workspace", "Mina studier")];
    for (let course = 1; course <= 2; course += 1) {
      const courseId = `course-${course}`;
      nodes.push(
        node(courseId, "workspace", "course", `Kurs ${course}`, course),
      );
      for (let module = 1; module <= 2; module += 1) {
        const moduleId = `${courseId}-module-${module}`;
        nodes.push(
          node(
            moduleId,
            courseId,
            "module",
            `Modul ${course}.${module}`,
            module,
          ),
        );
        for (let lecture = 1; lecture <= 4; lecture += 1) {
          const id = `${moduleId}-lecture-${lecture}`;
          nodes.push(
            node(
              id,
              moduleId,
              "lecture",
              `Föreläsning ${course}.${module}.${lecture}`,
              lecture,
            ),
          );
        }
      }
    }
    const lectures = Object.fromEntries(
      nodes
        .filter((item) => item.type === "lecture")
        .map((item) => [
          item.id,
          { lectureId: item.id, notes: `Egna anteckningar för ${item.title}.` },
        ]),
    );
    stored.state = {
      ...stored.state,
      nodes,
      lectures,
      segments: Array.from({ length: 5000 }, (_, index) => ({
        id: `session-segment-${index}`,
        lectureId: "course-1-module-1-lecture-1",
        start: index * 4,
        end: index * 4 + 4,
        text: `Klinisk genomgång av diagnostik, behandling och uppföljning, del ${index + 1}.`,
      })),
      markers: [
        {
          id: "session-marker",
          lectureId: "course-1-module-1-lecture-1",
          time: 40,
          note: "Viktig behandlingsprincip",
          createdAt,
        },
      ],
      cards: [
        {
          id: "session-card",
          lectureId: "course-1-module-1-lecture-1",
          type: "basic",
          front: "Vad är principen?",
          back: "Bedöm och behandla systematiskt.",
          tags: [],
          status: "approved",
        },
      ],
      selectedId: "course-1-module-1-lecture-1",
      activeView: "workspace",
    };
    stored.version = 19;
    localStorage.setItem(key, JSON.stringify(stored));
  }, stateKey);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Föreläsning 1.1.1", exact: true }),
  ).toBeVisible();
}

async function seedSuperActionLibrary(page: import("@playwright/test").Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-frontend="next"]')).toBeVisible();
  await page.waitForTimeout(350);
  await page.evaluate((key) => {
    const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
    const createdAt = "2026-01-01T00:00:00.000Z";
    const node = (
      id: string,
      parentId: string | null,
      type: string,
      title: string,
    ) => ({ id, parentId, type, title, context: "", createdAt, settings: {} });
    const ids = Array.from({ length: 8 }, (_, index) => `lecture-${index + 1}`);
    const nodes = [
      node("workspace", null, "workspace", "Mina studier"),
      node("course", "workspace", "course", "Klinisk kurs"),
      node("module", "course", "module", "Blandade föreläsningar"),
      ...ids.map((id, index) =>
        node(id, "module", "lecture", `Ämne ${index + 1}`),
      ),
    ];
    const lectures: Record<
      string,
      Record<string, unknown>
    > = Object.fromEntries(ids.map((id) => [id, { lectureId: id, notes: "" }]));
    lectures["lecture-1"].audioAssetId = "audio-1";
    lectures["lecture-2"].audioAssetId = "audio-2";
    lectures["lecture-4"].notes = "Symtom, diagnostik och behandling.";
    lectures["lecture-5"].slideAssetId = "slide-5";
    lectures["lecture-5"].slideName = "bilddiagnostik.pdf";
    const segments = [
      {
        id: "segment-2",
        lectureId: "lecture-2",
        start: 0,
        end: 5,
        text: "Utredning och klinisk handläggning.",
      },
    ];
    const cards = [
      {
        id: "generated-2",
        lectureId: "lecture-2",
        type: "basic",
        front: "Kort 2?",
        back: "Svar 2.",
        tags: [],
        status: "generated",
      },
      {
        id: "generated-6",
        lectureId: "lecture-6",
        type: "basic",
        front: "Kort 6?",
        back: "Svar 6.",
        tags: [],
        status: "generated",
      },
      {
        id: "approved-7",
        lectureId: "lecture-7",
        type: "basic",
        front: "Kort 7?",
        back: "Svar 7.",
        tags: [],
        status: "approved",
      },
      {
        id: "synced-8",
        lectureId: "lecture-8",
        type: "basic",
        front: "Kort 8?",
        back: "Svar 8.",
        tags: [],
        status: "synced",
      },
    ];
    stored.state = {
      ...stored.state,
      nodes,
      lectures,
      segments,
      markers: [],
      cards,
      selectedId: "lecture-1",
      activeView: "workspace",
    };
    stored.version = 19;
    localStorage.setItem(key, JSON.stringify(stored));
  }, stateKey);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Ämne 1", exact: true }),
  ).toBeVisible();
}

function wavFixture(seconds: number) {
  const sampleRate = 16_000;
  const samples = sampleRate * seconds;
  const data = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test("lång studiesession navigerar många föreläsningar och hanterar flera ljuddelar säkert", async ({
  page,
}, testInfo) => {
  test.skip(!nextMode, "Körs av test:e2e:next.");
  test.setTimeout(150_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedLongSession(page);

  // Expand the hierarchy as a user would, then revisit every lecture twice.
  for (const course of ["Kurs 1", "Kurs 2"]) {
    const expand = page.getByRole("button", {
      name: `Visa innehåll i ${course}`,
      exact: true,
    });
    if (await expand.count()) await expand.click();
  }
  for (const module of ["Modul 1.1", "Modul 1.2", "Modul 2.1", "Modul 2.2"]) {
    const expand = page.getByRole("button", {
      name: `Visa innehåll i ${module}`,
      exact: true,
    });
    if (await expand.count()) await expand.click();
  }
  const lectureNames = Array.from({ length: 16 }, (_, index) => {
    const course = Math.floor(index / 8) + 1;
    const module = Math.floor((index % 8) / 4) + 1;
    const lecture = (index % 4) + 1;
    return `Föreläsning ${course}.${module}.${lecture}`;
  });
  const navigationDurations: number[] = [];
  for (let cycle = 0; cycle < 2; cycle += 1) {
    for (const name of lectureNames) {
      const start = await page.evaluate(() => performance.now());
      await page
        .locator(".study-sidebar")
        .getByRole("button", { name, exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      navigationDurations.push(
        Math.round((await page.evaluate(() => performance.now())) - start),
      );
    }
  }

  await page
    .locator(".study-sidebar")
    .getByRole("button", { name: "Föreläsning 1.1.1", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Föreläsning 1.1.1", exact: true }),
  ).toBeVisible();
  await page.locator("input[name='lecture-audio']").setInputFiles(
    [1, 2, 3, 4, 5].map((part) => ({
      name: `Föreläsning-del-${part}.wav`,
      mimeType: "audio/wav",
      buffer: wavFixture(3),
    })),
  );
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const state = JSON.parse(localStorage.getItem(key) ?? "{}").state;
        return (
          state?.lectures?.["course-1-module-1-lecture-1"]?.audioParts
            ?.length ?? 0
        );
      }, stateKey),
    )
    .toBe(5);
  const deletedAssetId = await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key) ?? "{}").state;
    return state.lectures["course-1-module-1-lecture-1"].audioParts[0]
      .assetId as string;
  }, stateKey);
  await expect(
    page.getByRole("button", {
      name: "Ta bort Föreläsning-del-1.wav",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Ta bort Föreläsning-del-1.wav", exact: true })
    .click();
  const deleteDialog = page.getByRole("dialog", { name: "Ta bort ljudfilen?" });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog
    .getByRole("button", { name: "Ta bort", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const state = JSON.parse(localStorage.getItem(key) ?? "{}").state;
        return (
          state?.lectures?.["course-1-module-1-lecture-1"]?.audioParts?.map(
            (part: { name: string }) => part.name,
          ) ?? []
        );
      }, stateKey),
    )
    .toEqual([
      "Föreläsning-del-2.wav",
      "Föreläsning-del-3.wav",
      "Föreläsning-del-4.wav",
      "Föreläsning-del-5.wav",
    ]);
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const request = indexedDB.open("lectio-assets-next");
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const transaction = database.transaction("assets", "readonly");
        const storedAsset = await new Promise((resolve, reject) => {
          const read = transaction.objectStore("assets").get(id);
          read.onsuccess = () => resolve(read.result);
          read.onerror = () => reject(read.error);
        });
        database.close();
        return storedAsset !== undefined;
      }, deletedAssetId),
    )
    .toBe(false);

  // Reload is part of a normal study session: lecture metadata and audio blobs must survive.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Föreläsning 1.1.1", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".lecture-track-name")).toContainText(
    "Föreläsning-del-2.wav",
  );
  const renderer = await page.evaluate(() => ({
    domNodes: document.getElementsByTagName("*").length,
    transcriptRows: document.querySelectorAll(".lecture-transcript-row").length,
  }));
  await testInfo.attach("next-realistic-long-session.json", {
    body: JSON.stringify(
      {
        lecturesVisited: lectureNames.length * 2,
        transcriptSegments: 5000,
        audioPartsImported: 5,
        audioPartsRemaining: 4,
        navigationDurations,
        renderer,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  expect(Math.max(...navigationDurations)).toBeLessThan(2_500);
  expect(renderer.domNodes).toBeLessThan(12_000);
  expect(pageErrors).toEqual([]);
});

test("Superåtgärder filtrerar underlag, återkörning och kortåtgärder korrekt", async ({
  page,
}) => {
  test.skip(!nextMode, "Körs av test:e2e:next.");
  test.setTimeout(90_000);
  await seedSuperActionLibrary(page);
  await page.keyboard.press("Control+5");
  await expect(
    page.getByRole("heading", { name: "Superåtgärder", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Visa innehåll i Klinisk kurs", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Visa innehåll i Blandade föreläsningar",
      exact: true,
    })
    .click();

  // Audio action: no-audio lectures are disabled and completed transcripts only join when overwrite is enabled.
  await page.getByRole("button", { name: "Transkribera", exact: true }).click();
  await page.getByRole("button", { name: /^Välj alla/ }).click();
  await expect(page.getByText("1 valda", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Ämne 3/ })).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "Tillåt att befintligt resultat ersätts" })
    .check();
  await page.getByRole("button", { name: /^Välj alla/ }).click();
  await expect(page.getByText("2 valda", { exact: true })).toBeVisible();

  // Generation: text, notes and slides qualify; audio/card presence alone does not.
  await page
    .getByRole("button", { name: "Skapa Anki-kort", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Tillåt att befintligt resultat ersätts" })
    .uncheck();
  await page.getByRole("button", { name: /^Välj alla/ }).click();
  await expect(page.getByText("2 valda", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Ämne 1/ })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /Ämne 6/ })).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "Tillåt att befintligt resultat ersätts" })
    .check();
  await page.getByRole("button", { name: /^Välj alla/ }).click();
  await expect(page.getByText("3 valda", { exact: true })).toBeVisible();

  // Approval/sync/delete are enabled only for the right card states, then delete a selected lecture through its confirmation.
  await page.getByRole("button", { name: "Godkänn kort", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Tillåt att befintligt resultat ersätts" })
    .uncheck();
  await page.getByRole("button", { name: /^Välj alla/ }).click();
  await expect(page.getByText("2 valda", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Synka Anki-kort", exact: true })
    .click();
  await page.getByRole("button", { name: /^Välj alla/ }).click();
  await expect(page.getByText("1 valda", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Radera Anki-kort", exact: true })
    .click();
  await page.getByRole("checkbox", { name: "Ämne 2" }).check();
  await page
    .getByRole("button", { name: "Radera Anki-kort nu", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Radera valda Anki-kort?" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Skapa backup och fortsätt", exact: true })
    .click();
  await expect(page.getByText(/1 kort togs bort/)).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const state = JSON.parse(localStorage.getItem(key) ?? "{}").state;
        return state.cards.some(
          (card: { lectureId: string }) => card.lectureId === "lecture-2",
        );
      }, stateKey),
    )
    .toBe(false);
});
