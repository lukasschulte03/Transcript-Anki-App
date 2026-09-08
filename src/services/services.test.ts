import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTranscriptionPrompt,
  cloudApiTranscription,
  flagTranscriptionQuality,
  parseTimestampedText,
} from "./transcription";
import type { AppSettings, LibraryNode } from "../core/types";
import {
  canMoveLibraryNode,
  moveLibraryNode,
  reorderLibraryNode,
} from "../core/store";
import {
  createCardPrompt,
  cardPromptSummary,
  duplicateExplanation,
  generateCardsWithApi,
  aiModelSuggestions,
  selectRelevantExistingCards,
  parseCardResponse,
} from "./ai";
import { parseWhisperJson } from "./localStt";
import {
  hasClozeMarkup,
  lectureDeckName,
  needsAnkiSync,
  syncCard,
  testAnki,
  withoutStructuralTags,
} from "./anki";
import { builtInPalettes, validateTheme } from "../core/theme";
import { suggestSlideMappings } from "./slideMatching";
import { diagnosticSuggestions, redactDiagnosticText } from "./diagnostics";
import { canRecoverRecording } from "./recordingRecovery";
import { recommendLocalTranscription } from "./transcriptionRecommendation";
import {
  mergeLibrarySnapshots,
  mergeLibrarySnapshotsWithoutBase,
} from "./libraryMerge";
import type { LibrarySyncSnapshot } from "./libraryMerge";
import {
  estimateTranscriptionCost,
  formatTranscriptionCost,
} from "./transcriptionCost";
import { applySyncOperations, createSyncOperations } from "./syncV2";
import {
  audioFingerprint,
  audioMimeType,
  numberedAudioWarnings,
  sortAudioFiles,
  validateAudioFile,
} from "./audioImport";
import {
  inheritedGlossary,
  suggestGlossaryFromSlides,
  suggestTerminologyCorrections,
} from "./glossary";
import { chunkCardCeiling, planGenerationChunks } from "./ankiChunking";
import {
  estimateCardGenerationCost,
  estimateCardOutputTokens,
  formatCardGenerationCost,
} from "./cardGenerationCost";
import { runExclusiveTranscription } from "./transcriptionQueue";
import {
  moduleVisualCandidates,
  selectVisualCandidates,
  visualPromptLines,
} from "./visualIndex";
import {
  backupSourceFromState,
  normalizeLibraryBackup,
} from "./libraryBackup";
import { extractPptxImages } from "./pptx";
import { zipSync } from "fflate";

describe("Anki-chunkning", () => {
  it("behåller segment och delar bara vid segmentgränser", () => {
    const chunks = planGenerationChunks(
      [
        { id: "one", lectureId: "lecture", start: 10, end: 20, text: "a".repeat(30) },
        { id: "two", lectureId: "lecture", start: 20, end: 30, text: "b".repeat(30) },
      ],
      10,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0].transcript.map((segment) => segment.id)).toEqual(["one"]);
    expect(chunks[1].transcript.map((segment) => segment.id)).toEqual(["two"]);
    expect(chunkCardCeiling(36, chunks[0])).toBe(18);
  });
});

describe("biblioteksbackup", () => {
  it("migrerar en äldre metadata-backup utan att förlora innehållet", () => {
    const legacy = {
      id: "old",
      createdAt: "2026-01-01T00:00:00.000Z",
      reason: "manual" as const,
      nodes: [{ id: "course", parentId: "workspace", type: "course" as const, title: "KM3", sortIndex: 0, context: "", createdAt: "2026-01-01" }],
      lectures: { lecture: { lectureId: "lecture", notes: "Anteckning" } },
      segments: [{ id: "segment", lectureId: "lecture", start: 0, end: 1, text: "Text" }],
      markers: [{ id: "marker", lectureId: "lecture", timestamp: 0, createdAt: "2026-01-01" }],
      cards: [{ id: "card", lectureId: "lecture", type: "basic" as const, front: "Fråga", back: "Svar", tags: [], status: "approved" as const }],
      settings: { backupLimit: 10 },
      assetCount: 2,
    } as any;
    const backup = normalizeLibraryBackup(legacy);
    expect(backup.schemaVersion).toBe(2);
    expect(backup.assetIds).toEqual([]);
    expect(backup.lectures.lecture.notes).toBe("Anteckning");
    expect(backup.cards[0]?.front).toBe("Fråga");
  });

  it("tar en komplett återställningsbar metadata-snapshot", () => {
    const source = backupSourceFromState({
      nodes: [],
      lectures: { lecture: { lectureId: "lecture", notes: "N" } },
      segments: [{ id: "s", lectureId: "lecture", start: 0, end: 1, text: "T" }],
      markers: [],
      cards: [{ id: "c", lectureId: "lecture", type: "basic", front: "F", back: "B", tags: [], status: "generated" }],
      settings: { backupLimit: 5 },
    } as any);
    expect(source.lectures.lecture.notes).toBe("N");
    expect(source.segments).toHaveLength(1);
    expect(source.cards).toHaveLength(1);
  });
});

describe("modulens bildbibliotek", () => {
  it("återanvänder bilder från flera föreläsningar och gömmer lokalt rensade kandidater", () => {
    const nodes = [
      { id: "module", parentId: "course", type: "module", title: "Akut", sortIndex: 0, context: "", createdAt: "now" },
      { id: "one", parentId: "module", type: "lecture", title: "Rond", sortIndex: 0, context: "", createdAt: "now" },
      { id: "two", parentId: "module", type: "lecture", title: "EKG", sortIndex: 1, context: "", createdAt: "now" },
    ] as LibraryNode[];
    const lectures = {
      one: {
        lectureId: "one",
        notes: "",
        visualIndex: [{ id: "hidden", slidePage: 1, description: "Slide 1: Rond", keywords: ["rond"], sourceHash: "one", contentHash: "same" }],
        hiddenVisualIds: ["hidden"],
      },
      two: {
        lectureId: "two",
        notes: "",
        visualIndex: [{ id: "ecg", slidePage: 3, description: "Slide 3: EKG med ST-höjning", keywords: ["ekg", "st"], sourceHash: "two", contentHash: "ecg" }],
      },
    };
    const visible = moduleVisualCandidates(nodes, lectures, "module");
    expect(visible.map((candidate) => candidate.id)).toEqual(["ecg"]);
    expect(visible[0]?.description).toContain("EKG · Slide 3");
    const all = moduleVisualCandidates(nodes, lectures, "module", { includeHidden: true });
    expect(all.map((candidate) => candidate.id)).toEqual(["hidden", "ecg"]);
  });
});

describe("PowerPoint-bilder", () => {
  it("extraherar bara lokala rasterbilder ur en PPTX", async () => {
    const archive = zipSync({
      "ppt/media/image1.png": new Uint8Array([137, 80, 78, 71]),
      "ppt/slides/slide1.xml": new TextEncoder().encode(
        '<p:sld xmlns:a="a" xmlns:r="r"><a:t>ST-höjning på EKG</a:t><a:blip r:embed="rId1" /></p:sld>',
      ),
      "ppt/slides/_rels/slide1.xml.rels": new TextEncoder().encode(
        '<Relationships><Relationship Id="rId1" Target="../media/image1.png" /></Relationships>',
      ),
      "docProps/core.xml": new Uint8Array([60, 99, 111, 114, 101, 62]),
    });
    const images = await extractPptxImages(
      new Blob([archive.buffer as ArrayBuffer], {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      }),
    );
    expect(images).toHaveLength(1);
    expect(images[0]?.name).toBe("image1.png");
    expect(images[0]?.blob.type).toBe("image/png");
    expect(images[0]?.slidePage).toBe(1);
    expect(images[0]?.nearbyText).toContain("ST-höjning");
  });
});

describe("Anki-kostnad", () => {
  it("räknar lokalt för modeller med versionsstyrd prisdata", () => {
    const estimate = estimateCardGenerationCost(
      "openai",
      "gpt-4.1-mini",
      10_000,
      1_000,
    );
    expect(estimate.usd).toBeCloseTo(0.0056);
    expect(formatCardGenerationCost(estimate)).toContain("0,006");
    expect(estimateCardOutputTokens(16)).toBe(1_760);
  });

  it("hittar inte på ett pris för okända modeller", () => {
    expect(
      estimateCardGenerationCost("groq", "egen-modell", 10_000, 1_000).usd,
    ).toBeUndefined();
  });
});

describe("gemensam transkriptionskö", () => {
  it("kör batch- och vanliga arbeten en i taget", async () => {
    const order: string[] = [];
    let concurrent = 0;
    let peak = 0;
    const task = (name: string) =>
      runExclusiveTranscription(name, async () => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        order.push(`start:${name}`);
        await Promise.resolve();
        order.push(`end:${name}`);
        concurrent -= 1;
      });

    await Promise.all([task("foreground"), task("batch")]);
    expect(peak).toBe(1);
    expect(order).toEqual([
      "start:foreground",
      "end:foreground",
      "start:batch",
      "end:batch",
    ]);
  });
});

describe("fraslexikon", () => {
  it("ärver termer och föreslår inte ändringar av korrekt text", () => {
    const nodes = [
      {
        id: "course",
        parentId: null,
        type: "course",
        title: "Kurs",
        context: "",
        createdAt: "",
        settings: { transcriptionGlossary: "ileus" },
      },
      {
        id: "lecture",
        parentId: "course",
        type: "lecture",
        title: "Föreläsning",
        context: "",
        createdAt: "",
        settings: { transcriptionGlossary: "peritonit" },
      },
    ] as any;
    expect(inheritedGlossary(nodes, "lecture", "ABCDE").terms).toEqual([
      "ABCDE",
      "ileus",
      "peritonit",
    ]);
    expect(
      suggestTerminologyCorrections(
        [
          {
            id: "s",
            lectureId: "lecture",
            start: 0,
            end: 1,
            text: "peritonit",
          },
        ],
        ["peritonit"],
      ),
    ).toEqual([]);
    expect(suggestGlossaryFromSlides("ABCDE vid kolecystit")).toContain(
      "ABCDE",
    );
  });
});

describe("mobil ljudimport", () => {
  const audio = (name: string, size = 1024, lastModified = 1) =>
    ({ name, size, lastModified, type: "" }) as File;

  it("accepterar mobilformat utan pålitlig MIME-typ och sorterar naturligt", () => {
    expect(validateAudioFile(audio("Voice 01.m4a"))).toBeUndefined();
    expect(validateAudioFile(audio("föreläsning.mp4"))).toBeUndefined();
    expect(audioMimeType(audio("Voice 01.m4a"))).toBe("audio/mp4");
    expect(
      sortAudioFiles([audio("del 10.m4a"), audio("del 2.m4a")]).map(
        (file) => file.name,
      ),
    ).toEqual(["del 2.m4a", "del 10.m4a"]);
  });

  it("varnar för luckor och använder ett stabilt källfingeravtryck", () => {
    expect(
      numberedAudioWarnings([audio("del 1.m4a"), audio("del 3.m4a")])[0],
    ).toContain("kan saknas");
    expect(audioFingerprint(audio("Rond.M4A", 42, 9))).toBe(
      audioFingerprint(audio("rond.m4a", 42, 9)),
    );
  });
});

describe("Anki-promptens budget och dubblettskydd", () => {
  it("skickar bara lokalt relevanta bildbeskrivningar till prompten", () => {
    const candidates = selectVisualCandidates(
      [
        {
          id: "ecg",
          slidePage: 4,
          description: "Slide 4: EKG med ST-höjning vid inferior STEMI.",
          keywords: ["ekg", "st", "höjning", "inferior", "stemi"],
          sourceHash: "slide",
        },
        {
          id: "kidney",
          slidePage: 5,
          description: "Slide 5: Njurens anatomi.",
          keywords: ["njure", "anatomi"],
          sourceHash: "slide",
        },
      ],
      "Vilka EKG-avledningar visar ST-höjning vid inferior STEMI?",
    );
    expect(candidates.map((candidate) => candidate.id)).toEqual(["ecg", "kidney"]);
    expect(visualPromptLines(candidates)).toContain("ecg | Slide 4");
  });

  it("skickar bara lexikalt relevanta befintliga kort", () => {
    const cards = selectRelevantExistingCards(
      [
        { front: "Hur behandlas hyperkalemi?", back: "Kalcium och insulin." },
        { front: "Vad är en mitokondrie?", back: "Cellorganell." },
      ],
      "Akut behandling av hyperkalemi med insulin",
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]?.front).toContain("hyperkalemi");
  });

  it("begränsar stora källor till den definierade budgeten", () => {
    const summary = cardPromptSummary({
      lectureId: "lecture",
      title: "Akut peritonit",
      context: "C".repeat(200_000),
      notes: "N".repeat(200_000),
      transcript: [],
      markers: [],
      slideText: "S".repeat(200_000),
      count: 36,
      types: ["basic"],
      preferences: [],
      contextBudget: 1_000,
    });
    expect(summary.estimatedTokens).toBeLessThanOrEqual(1_000);
    expect(summary.omitted).toBeGreaterThan(0);
    expect(
      createCardPrompt({
        lectureId: "lecture",
        title: "Akut buk",
        context: "C".repeat(200_000),
        notes: "N".repeat(200_000),
        transcript: [],
        markers: [],
        slideText: "S".repeat(200_000),
        count: 36,
        types: ["basic"],
        preferences: [],
        contextBudget: 1_000,
      }).length,
    ).toBeLessThanOrEqual(
      4_000 + "\n[Förkortat för att hålla prompten inom budget]".length,
    );
  });
});

describe("diagnostik", () => {
  it("rensar sökvägar, e-post och tokens innan en rapport delas", () => {
    const result = redactDiagnosticText(
      "C:\\Users\\Lukas\\Documents\\fil.wav apiKey=hemlig lukas@example.com",
    );
    expect(result).not.toContain("Lukas");
    expect(result).not.toContain("hemlig");
    expect(result).not.toContain("lukas@example.com");
    expect(result).toContain("[redacted-path]");
  });

  it("ger ett säkert, relevant felsökningsförslag", () => {
    expect(
      diagnosticSuggestions([
        {
          at: "now",
          area: "app",
          message: "Command plugin:opener|open_url not allowed by ACL",
        },
      ])[0],
    ).toContain("senaste Lectio-versionen");
  });
});

describe("Google Drive-synk", () => {
  it("förenar PC:ns nya transkript med laptopens nya föreläsning", () => {
    const base = {
      nodes: [
        {
          id: "workspace",
          type: "workspace",
          parentId: null,
          title: "Studier",
          context: "",
          createdAt: "",
          settings: {},
        },
        {
          id: "lecture-a",
          type: "lecture",
          parentId: "workspace",
          title: "A",
          context: "",
          createdAt: "",
          settings: {},
        },
      ],
      lectures: { "lecture-a": { lectureId: "lecture-a", notes: "" } },
      segments: [],
      markers: [],
      cards: [],
      pendingAnkiDeletions: [],
      settings: {} as AppSettings,
    } satisfies LibrarySyncSnapshot;
    const local = {
      ...base,
      segments: [
        {
          id: "segment-a",
          lectureId: "lecture-a",
          start: 0,
          end: 2,
          text: "PC-transkript",
        },
      ],
    };
    const remote = {
      ...base,
      nodes: [
        ...base.nodes,
        {
          id: "lecture-b",
          type: "lecture" as const,
          parentId: "workspace",
          title: "B",
          context: "",
          createdAt: "",
          settings: {},
        },
      ],
      lectures: {
        ...base.lectures,
        "lecture-b": { lectureId: "lecture-b", notes: "Laptopens slides" },
      },
    };
    const result = mergeLibrarySnapshots(base, local, remote);
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot.segments[0]?.text).toBe("PC-transkript");
    expect(result.snapshot.lectures["lecture-b"]?.notes).toBe(
      "Laptopens slides",
    );
  });

  it("flaggar när samma fält ändrats olika på två datorer", () => {
    const base = {
      nodes: [],
      lectures: { lecture: { lectureId: "lecture", notes: "Bas" } },
      segments: [],
      markers: [],
      cards: [],
      pendingAnkiDeletions: [],
      settings: {} as AppSettings,
    } satisfies LibrarySyncSnapshot;
    const result = mergeLibrarySnapshots(
      base,
      { ...base, lectures: { lecture: { lectureId: "lecture", notes: "PC" } } },
      {
        ...base,
        lectures: { lecture: { lectureId: "lecture", notes: "Laptop" } },
      },
    );
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({ collection: "föreläsningar", field: "notes" }),
    );
  });

  it("ignorerar enhetsinställningar när två datorer har synkat vid olika tidpunkter", () => {
    const base = {
      nodes: [],
      lectures: {},
      segments: [],
      markers: [],
      cards: [],
      pendingAnkiDeletions: [],
      settings: {
        cloudSync: {
          provider: "google-drive",
          remotePath: "Lectio",
          autoSyncOnStartAndClose: true,
          lastSyncedAt: "2026-09-07T08:00:00Z",
        },
      } as AppSettings,
    } satisfies LibrarySyncSnapshot;
    const local = {
      ...base,
      settings: {
        ...base.settings,
        cloudSync: {
          ...base.settings.cloudSync,
          lastSyncedAt: "2026-09-07T09:00:00Z",
        },
      },
    };
    const remote = {
      ...base,
      settings: {
        ...base.settings,
        cloudSync: {
          ...base.settings.cloudSync,
          lastSyncedAt: "2026-09-07T10:00:00Z",
        },
      },
    };
    const result = mergeLibrarySnapshots(base, local, remote);
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot.settings.cloudSync.lastSyncedAt).toBe(
      "2026-09-07T09:00:00Z",
    );
  });

  it("förenar säkert orelaterade ändringar när en igenkänd installation saknar synkbas", () => {
    const local = {
      nodes: [
        {
          id: "workspace",
          type: "workspace",
          parentId: null,
          title: "Studier",
          context: "",
          createdAt: "",
          settings: {},
        },
      ],
      lectures: {
        "lecture-local": { lectureId: "lecture-local", notes: "Laptop" },
      },
      segments: [],
      markers: [],
      cards: [],
      pendingAnkiDeletions: [],
      settings: {} as AppSettings,
    } satisfies LibrarySyncSnapshot;
    const remote = {
      ...local,
      lectures: {
        ...local.lectures,
        "lecture-remote": { lectureId: "lecture-remote", notes: "PC" },
      },
    };
    const result = mergeLibrarySnapshotsWithoutBase(local, remote);
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot.lectures).toMatchObject({
      "lecture-local": { notes: "Laptop" },
      "lecture-remote": { notes: "PC" },
    });
  });

  it("ber om ett val för ändrat delat innehåll utan synkbas", () => {
    const local = {
      nodes: [],
      lectures: { lecture: { lectureId: "lecture", notes: "Laptop" } },
      segments: [],
      markers: [],
      cards: [],
      pendingAnkiDeletions: [],
      settings: {} as AppSettings,
    } satisfies LibrarySyncSnapshot;
    const remote = {
      ...local,
      lectures: { lecture: { lectureId: "lecture", notes: "PC" } },
    };
    expect(
      mergeLibrarySnapshotsWithoutBase(local, remote).conflicts,
    ).toContainEqual(
      expect.objectContaining({ collection: "föreläsningar", field: "notes" }),
    );
  });
});

describe("Sync v2", () => {
  const snapshot = (notes = "", markerNote = "") =>
    ({
      nodes: [],
      lectures: { lecture: { lectureId: "lecture", notes } },
      segments: [],
      markers: markerNote
        ? [
            {
              id: "marker",
              lectureId: "lecture",
              time: 5,
              note: markerNote,
              createdAt: "",
            },
          ]
        : [],
      cards: [],
      pendingAnkiDeletions: [],
      settings: {} as AppSettings,
    }) satisfies LibrarySyncSnapshot;

  it("förenar olika fält i samma föreläsning utan konfliktfråga", () => {
    const base = snapshot("Bas");
    const local = {
      ...base,
      lectures: { lecture: { lectureId: "lecture", notes: "PC-anteckning" } },
    };
    const remote = {
      ...base,
      markers: [
        {
          id: "marker",
          lectureId: "lecture",
          time: 5,
          note: "Laptop-markering",
          createdAt: "",
        },
      ],
    };
    const left = createSyncOperations(base, local, {
      libraryId: "library",
      deviceId: "pc",
      nextSequence: 1,
      at: "2026-09-07T10:00:00Z",
    });
    const right = createSyncOperations(base, remote, {
      libraryId: "library",
      deviceId: "laptop",
      nextSequence: 1,
      at: "2026-09-07T10:01:00Z",
    });
    const merged = applySyncOperations(base, [
      ...left.operations,
      ...right.operations,
    ]);
    expect(merged.lectures.lecture.notes).toBe("PC-anteckning");
    expect(merged.markers[0]?.note).toBe("Laptop-markering");
  });

  it("låter en tombstone vinna över en äldre uppdatering", () => {
    const base = snapshot("Bas", "Viktig");
    const edit = createSyncOperations(base, snapshot("Bas", "Ändrad"), {
      libraryId: "library",
      deviceId: "old",
      nextSequence: 1,
      at: "2026-09-07T10:00:00Z",
    });
    const deletion = createSyncOperations(base, snapshot("Bas"), {
      libraryId: "library",
      deviceId: "new",
      nextSequence: 1,
      at: "2026-09-07T11:00:00Z",
    });
    const merged = applySyncOperations(base, [
      ...edit.operations,
      ...deletion.operations,
    ]);
    expect(merged.markers).toEqual([]);
  });
});

describe("biblioteksträd", () => {
  const node = (
    id: string,
    type: LibraryNode["type"],
    parentId: string | null,
    sortIndex: number,
  ): LibraryNode => ({
    id,
    type,
    parentId,
    sortIndex,
    title: id,
    context: "",
    createdAt: "",
    settings: {},
  });
  const tree = [
    node("workspace", "workspace", null, 0),
    node("course-a", "course", "workspace", 0),
    node("course-b", "course", "workspace", 1),
    node("module-a", "module", "course-a", 0),
    node("module-b", "module", "course-b", 0),
  ];

  it("flyttar bara till en ny giltig förälder", () => {
    expect(canMoveLibraryNode(tree, "module-a", "course-a")).toBe(false);
    expect(canMoveLibraryNode(tree, "module-a", "course-b")).toBe(true);
    expect(canMoveLibraryNode(tree, "course-a", "module-a")).toBe(false);
  });

  it("håller syskons ordning konsekvent vid flytt och omordning", () => {
    const moved = moveLibraryNode(tree, "module-a", "course-b");
    expect(
      moved
        .filter((item) => item.parentId === "course-b")
        .sort((a, b) => a.sortIndex! - b.sortIndex!)
        .map((item) => [item.id, item.sortIndex]),
    ).toEqual([
      ["module-b", 0],
      ["module-a", 1],
    ]);

    const reordered = reorderLibraryNode(tree, "course-b", "course-a");
    expect(
      reordered
        .filter((item) => item.parentId === "workspace")
        .sort((a, b) => a.sortIndex! - b.sortIndex!)
        .map((item) => [item.id, item.sortIndex]),
    ).toEqual([
      ["course-b", 0],
      ["course-a", 1],
    ]);
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("teman", () => {
  it("har komplett kontrastvaliderad tokenuppsättning", () => {
    expect(builtInPalettes.flatMap(validateTheme)).toEqual([]);
  });
});

describe("transkriptimport", () => {
  it("tolkar en mockad API-transkribering utan nyckel eller extern provider", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            text: "Mockad transkription",
            segments: [{ start: 0, end: 3, text: "Mockad transkription" }],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await cloudApiTranscription.transcribe(
      new Blob(["ljud"], { type: "audio/wav" }),
      { transcriptionBaseUrl: "https://mock.example/v1" } as AppSettings,
      "testnyckel",
      "ABCDE",
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.segments).toEqual([
      { start: 0, end: 3, text: "Mockad transkription" },
    ]);
  });

  it("använder bara STT-ordlistan, inte ärvd kurscontext", () => {
    const prompt = buildTranscriptionPrompt("ABCDE, CRP");
    expect(prompt).toBe("ABCDE, CRP");
  });

  it("läser svenska tidsstämplar", () => {
    const result = parseTimestampedText(
      "00:12–00:20 Första delen\n01:02:03–01:02:10 Senare del",
    );
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({
      start: 12,
      end: 20,
      text: "Första delen",
    });
    expect(result.segments[1].start).toBe(3723);
  });
  it("läser segment från lokal Whisper", () => {
    const result = parseWhisperJson(
      '{"transcription":[{"timestamps":{"from":"00:00:00,000","to":"00:00:02,500"},"offsets":{"from":0,"to":2500},"text":" Hej världen"}]}',
    );
    expect(result.segments[0]).toEqual({
      start: 0,
      end: 2.5,
      text: "Hej världen",
    });
  });
  it("flaggar dubbletter och orimligt korta segment utan att ta bort dem", () => {
    const result = flagTranscriptionQuality([
      { start: 0, end: 2, text: "Viktigt begrepp" },
      { start: 2, end: 4, text: "Viktigt begrepp" },
      { start: 4, end: 5, text: "ja" },
    ]);
    expect(result).toHaveLength(3);
    expect(result[1].suspicious).toBe(true);
    expect(result[1].qualityFlags).toContain("duplicate");
    expect(result[2].suspicious).toBe(true);
    expect(result[2].qualityFlags).toContain("very-short");
  });
  it("markerar tomma och upprepade fraser utan att filtrera bort text", () => {
    const result = flagTranscriptionQuality([
      { start: 0, end: 2, text: "" },
      {
        start: 2,
        end: 8,
        text: "detta är en viktig fras detta är en viktig fras",
      },
    ]);
    expect(result[0].qualityFlags).toContain("empty");
    expect(result[1].qualityFlags).toContain("repeated-phrase");
  });
  it("flaggar sannolika Whisper-upprepningar för granskning", () => {
    const result = parseWhisperJson(
      '{"transcription":[{"offsets":{"from":0,"to":4000},"text":"Det här viktiga begreppet kommer på tentamen."},{"offsets":{"from":4000,"to":8000},"text":"Det här viktiga begreppet kommer på tentamen."}]}',
    );
    expect(result.segments[1].suspicious).toBe(true);
  });
});

describe("transkriptionskostnad", () => {
  it("uppskattar kända modellpriser lokalt från ljudlängd", () => {
    const estimate = estimateTranscriptionCost("openai", "whisper-1", 600);
    expect(estimate.usd).toBeCloseTo(0.06);
    expect(formatTranscriptionCost(estimate)).toContain("0,06");
  });

  it("visar ingen påhittad kostnad för okända modeller", () => {
    expect(
      estimateTranscriptionCost("groq", "egen-modell", 600).usd,
    ).toBeUndefined();
  });
});

describe("transkriptionsrekommendation", () => {
  it("väljer Large v3 Turbo när NVIDIA-motorn är redo", () => {
    const result = recommendLocalTranscription({
      durationSeconds: 60 * 45,
      engine: {
        cpuThreads: 20,
        nvidiaDetected: true,
        nvidiaName: "RTX",
        nvidiaRuntimeInstalled: true,
        nvidiaRuntimeReady: true,
        nvidiaRuntimeSize: 1,
        nvidiaVramTotalMb: 10_240,
      },
    });
    expect(result.model).toBe("large-v3-turbo");
    expect(result.estimate).toContain("NVIDIA");
  });

  it("väljer Base för ett långt CPU-jobb och varnar om NVIDIA inte är redo", () => {
    const result = recommendLocalTranscription({
      durationSeconds: 60 * 150,
      engine: {
        cpuThreads: 8,
        nvidiaDetected: true,
        nvidiaName: "RTX",
        nvidiaRuntimeInstalled: true,
        nvidiaRuntimeReady: false,
        nvidiaRuntimeSize: 1,
        nvidiaVramTotalMb: 10_240,
      },
    });
    expect(result.model).toBe("base");
    expect(result.warning).toContain("inte redo");
  });

  it("använder ett matchande lokalt benchmark för tidsuppskattningen", () => {
    const result = recommendLocalTranscription({
      durationSeconds: 60 * 10,
      engine: {
        cpuThreads: 8,
        nvidiaDetected: false,
        nvidiaName: null,
        nvidiaRuntimeInstalled: false,
        nvidiaRuntimeReady: false,
        nvidiaRuntimeSize: 0,
        nvidiaVramTotalMb: null,
      },
      benchmarks: {
        cpu: {
          model: "base",
          acceleration: "cpu",
          realtimeFactor: 0.1,
          durationSeconds: 20,
          elapsedSeconds: 2,
          gpuUsed: false,
          measuredAt: "now",
        },
      },
    });
    expect(result.estimate).toContain("baserat på ditt test");
  });
});

describe("inspelningsåterställning", () => {
  it("erbjuder återställning för en simulerat avbruten inspelning med sparade ljuddelar", () => {
    expect(canRecoverRecording({ status: "interrupted" }, 3)).toBe(true);
    expect(canRecoverRecording({ status: "paused" }, 1)).toBe(true);
    expect(canRecoverRecording({ status: "interrupted" }, 0)).toBe(false);
  });
});

describe("slidekoppling", () => {
  it("matchar transkript mot slide-text i presentationsordning", () => {
    const result = suggestSlideMappings(
      [
        "Introduktion till sepsis och qSOFA",
        "Behandling med vätska och antibiotika",
      ],
      [
        {
          id: "one",
          lectureId: "lecture",
          start: 0,
          end: 4,
          text: "qSOFA används vid sepsis",
        },
        {
          id: "two",
          lectureId: "lecture",
          start: 5,
          end: 9,
          text: "vätska och antibiotika är första behandling",
        },
      ],
    );
    expect(result.one.page).toBe(1);
    expect(result.two.page).toBe(2);
  });

  it("lämnar osäkra matchningar omappade", () => {
    const result = suggestSlideMappings(
      ["Mekanisk ventilation, tidalvolym och PEEP"],
      [
        {
          id: "one",
          lectureId: "lecture",
          start: 0,
          end: 4,
          text: "patientens anamnes diskuterades",
        },
      ],
    );
    expect(result.one).toBeUndefined();
  });
});

describe("kortformat", () => {
  it("erbjuder modellförslag men lämnar utrymme för egna modell-ID:n", () => {
    expect(aiModelSuggestions.openai).toContain("gpt-4.1-mini");
    expect(aiModelSuggestions.custom).toEqual([]);
  });

  it("använder en egen OpenAI-kompatibel endpoint och validerar dess URL", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"cards":[]}' } }],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const settings = {
      aiProvider: "custom",
      aiModel: "min-lokala-modell",
      aiBaseUrl: "http://localhost:1234/v1/",
    } as AppSettings;

    await generateCardsWithApi("Skapa kort", settings, "testnyckel");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:1234/v1/chat/completions",
      expect.any(Object),
    );
    await expect(
      generateCardsWithApi(
        "Skapa kort",
        { ...settings, aiBaseUrl: "" },
        "testnyckel",
      ),
    ).rejects.toThrow("bas-URL");
  });

  it("bygger en kompakt prompt utan instruktioner för otillåtna korttyper", () => {
    const prompt = createCardPrompt({
      lectureId: "lecture",
      title: "Akut peritonit",
      context: "",
      notes: "",
      transcript: [],
      markers: [],
      slideText: "",
      count: 12,
      types: ["basic", "concept"],
      preferences: [],
      existingCards: [
        { front: "Vad är peritonit?", back: "Inflammation i peritoneum." },
      ],
    });
    expect(prompt).toContain("NÄRLIGGANDE BEFINTLIGA KORT");
    expect(prompt).toContain("Vad är peritonit?");
    expect(prompt).toContain("Promptversion: 2");
    expect(prompt).toContain("Använd endast uttryckligt källstöd");
    expect(prompt).toContain('"type":"basic|concept"');
    expect(prompt).toContain("basic: en tydlig fråga");
    expect(prompt).toContain("concept: testa ett samband");
    expect(prompt).not.toContain("cloze: front måste");
    expect(prompt).not.toContain("problem: testa en konkret");
    expect(prompt).not.toContain("Terminologi: Vad");
    expect(
      duplicateExplanation("Vad är akut peritonit?", {
        front: "Vad är peritonit?",
      }),
    ).toContain("peritonit");
  });

  it("beskriver endast cloze-regler när cloze har valts", () => {
    const prompt = createCardPrompt({
      lectureId: "lecture",
      title: "Akut buk",
      context: "",
      notes: "",
      transcript: [],
      markers: [],
      slideText: "",
      count: 12,
      types: ["cloze"],
      preferences: [],
    });
    expect(prompt).toContain(
      "cloze: front måste innehålla minst en giltig {{c1::...}}-markering",
    );
    expect(prompt).not.toContain("basic: en tydlig fråga");
  });

  it("skapar Anki-hierarki från kurs, modul och föreläsning", () => {
    const nodes = [
      {
        id: "course",
        parentId: null,
        type: "course",
        title: "Kirurgi",
        context: "",
        createdAt: "",
        settings: {},
      },
      {
        id: "module",
        parentId: "course",
        type: "module",
        title: "Akut kirurgi",
        context: "",
        createdAt: "",
        settings: {},
      },
      {
        id: "lecture",
        parentId: "module",
        type: "lecture",
        title: "Akut buk",
        context: "",
        createdAt: "",
        settings: {},
      },
    ] as const;
    expect(lectureDeckName([...nodes], "lecture")).toBe(
      "Kirurgi - Lectio::Akut kirurgi::Akut buk",
    );
  });

  it("behåller egna taggar men tar bort gamla struktur-taggar", () => {
    expect(
      withoutStructuralTags(["course::km3", "lecture::akut-buk", "tentamen"]),
    ).toEqual(["tentamen"]);
  });

  it("synkar bara Anki-kort som är nya, ändrade eller har flyttats", () => {
    const card = {
      id: "card",
      lectureId: "lecture",
      type: "basic" as const,
      front: "Fråga",
      back: "Svar",
      tags: [],
      status: "synced" as const,
      ankiId: 42,
      ankiDeck: "Kirurgi - Lectio::Akut buk",
    };
    expect(needsAnkiSync(card, "Kirurgi - Lectio::Akut buk")).toBe(false);
    expect(needsAnkiSync(card, "Kirurgi - Lectio::Trauma")).toBe(true);
    expect(needsAnkiSync({ ...card, status: "approved" }, card.ankiDeck)).toBe(
      true,
    );
  });

  it("skapar ett Basic-kort via en mockad AnkiConnect utan extern app", async () => {
    const requests: Array<{ action: string; params: Record<string, unknown> }> =
      [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as {
          action: string;
          params: Record<string, unknown>;
        };
        requests.push(body);
        const result =
          body.action === "modelFieldNames" ? ["Front", "Back"] : 123;
        return new Response(JSON.stringify({ result, error: null }), {
          status: 200,
        });
      }),
    );
    const noteId = await syncCard("http://127.0.0.1:8765", "Kirurgi - Lectio", {
      id: "card",
      lectureId: "lecture",
      type: "basic",
      front: "Fråga",
      back: "Svar",
      tags: ["tentamen"],
      status: "approved",
    });
    expect(noteId).toBe(123);
    expect(requests.map((request) => request.action)).toEqual([
      "modelFieldNames",
      "addNote",
    ]);
    expect(requests[1].params).toMatchObject({
      note: {
        deckName: "Kirurgi - Lectio",
        fields: { Front: "Fråga", Back: "Svar" },
      },
    });
  });

  it("skapar ett Cloze-kort med Ankis Text- och Extra-fält", async () => {
    const requests: Array<{ action: string; params: Record<string, unknown> }> =
      [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as {
          action: string;
          params: Record<string, unknown>;
        };
        requests.push(body);
        const result =
          body.action === "modelFieldNames" ? ["Text", "Extra"] : 321;
        return new Response(JSON.stringify({ result, error: null }), {
          status: 200,
        });
      }),
    );

    await expect(
      syncCard("http://127.0.0.1:8765", "Kirurgi - Lectio", {
        id: "cloze",
        lectureId: "lecture",
        type: "cloze",
        front: "Blodets pH hålls stabilt av {{c1::buffertsystem}}.",
        back: "Viktig princip.",
        tags: [],
        status: "approved",
      }),
    ).resolves.toBe(321);
    expect(requests.map((request) => request.action)).toEqual([
      "modelFieldNames",
      "addNote",
    ]);
    expect(requests[1].params).toMatchObject({
      note: {
        modelName: "Cloze",
        fields: {
          Text: "Blodets pH hålls stabilt av {{c1::buffertsystem}}.",
          Extra: "Viktig princip.",
        },
      },
    });
  });

  it("skickar en vald slidebild först när kortet synkas", async () => {
    const requests: Array<{ action: string; params: Record<string, unknown> }> =
      [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as {
          action: string;
          params: Record<string, unknown>;
        };
        requests.push(body);
        const result =
          body.action === "modelFieldNames" ? ["Front", "Back"] : 456;
        return new Response(JSON.stringify({ result, error: null }), {
          status: 200,
        });
      }),
    );
    await syncCard(
      "http://127.0.0.1:8765",
      "Kirurgi - Lectio",
      {
        id: "card-with-slide",
        lectureId: "lecture",
        type: "basic",
        front: "Fråga",
        back: "Svar",
        tags: [],
        status: "approved",
      },
      {
        filename: "lectio-slide.png",
        data: "base64-data",
        caption: "Bild från slide 4",
      },
    );
    expect(requests.map((request) => request.action)).toEqual([
      "storeMediaFile",
      "modelFieldNames",
      "addNote",
    ]);
    expect(requests[2].params).toMatchObject({
      note: {
        fields: {
          Back: expect.stringContaining('<img src="lectio-slide.png">'),
        },
      },
    });
  });

  it("stoppar ett Cloze-kort utan Anki-markering innan det skickas", async () => {
    await expect(
      syncCard("http://127.0.0.1:8765", "Lectio", {
        id: "invalid-cloze",
        lectureId: "lecture",
        type: "cloze",
        front: "Vilket system stabiliserar blodets pH?",
        back: "Buffertsystem.",
        tags: [],
        status: "approved",
      }),
    ).rejects.toThrow("saknar Anki-markering");
    expect(hasClozeMarkup("{{c1::buffertsystem}}")).toBe(true);
    expect(hasClozeMarkup("Buffertsystem")).toBe(false);
  });

  it("ersätter säkert en synkad Basic-not när kortet ändras till Cloze", async () => {
    const requests: Array<{ action: string; params: Record<string, unknown> }> =
      [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as {
          action: string;
          params: Record<string, unknown>;
        };
        requests.push(body);
        const result =
          body.action === "modelFieldNames"
            ? ["Text", "Extra"]
            : body.action === "notesInfo"
              ? [{ modelName: "Basic", tags: ["lectio"] }]
              : body.action === "addNote"
                ? 987
                : null;
        return new Response(JSON.stringify({ result, error: null }), {
          status: 200,
        });
      }),
    );

    await expect(
      syncCard("http://127.0.0.1:8765", "Lectio", {
        id: "changed",
        lectureId: "lecture",
        type: "cloze",
        ankiId: 42,
        front: "Detta är {{c1::ett cloze-kort}}.",
        back: "Förklaring.",
        tags: [],
        status: "approved",
      }),
    ).resolves.toBe(987);
    expect(requests.map((request) => request.action)).toEqual([
      "modelFieldNames",
      "notesInfo",
      "addNote",
      "deleteNotes",
    ]);
  });

  it("kan försöka om en misslyckad Anki-synk mot samma lokala mock", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        attempts++;
        if (attempts === 1)
          return new Response("Tillfälligt fel", { status: 503 });
        const body = JSON.parse(String(init.body)) as { action: string };
        const result =
          body.action === "modelFieldNames" ? ["Front", "Back"] : 456;
        return new Response(JSON.stringify({ result, error: null }), {
          status: 200,
        });
      }),
    );
    const card = {
      id: "retry-card",
      lectureId: "lecture",
      type: "basic" as const,
      front: "Fråga",
      back: "Svar",
      tags: [],
      status: "approved" as const,
    };

    await expect(
      syncCard("http://127.0.0.1:8765", "Lectio", card),
    ).rejects.toThrow("503");
    await expect(
      syncCard("http://127.0.0.1:8765", "Lectio", card),
    ).resolves.toBe(456);
    expect(attempts).toBe(3);
  });

  it("vägrar skicka AnkiConnect-anrop utanför datorn", async () => {
    await expect(testAnki("https://exempel.se")).rejects.toThrow(
      "AnkiConnect måste köras lokalt",
    );
  });

  it("rensar kodblock och validerar JSON", () => {
    const result = parseCardResponse(
      '```json\n{"cards":[{"type":"basic","front":"Fråga?","back":"Svar","tags":["kurs"]}]}\n```',
      "lecture-1",
    );
    expect(result[0]).toMatchObject({
      lectureId: "lecture-1",
      status: "generated",
      front: "Fråga?",
    });
  });

  it("tar bort den överflödiga Terminologi-etiketten från nya kort", () => {
    const result = parseCardResponse(
      '{"cards":[{"type":"basic","front":"Terminologi: Vad betyder ileus?","back":"Tarmstopp.","tags":[]}]}',
      "lecture-1",
    );
    expect(result[0]?.front).toBe("Vad betyder ileus?");
  });

  it("reparerar inledande text och avslutande kommatecken", () => {
    const result = parseCardResponse(
      'Här är resultatet:\n{"cards":[{"front":"Fråga?","back":"Svar",}],}',
      "lecture-1",
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("basic");
  });

  it("bygger en prompt med alla källor", () => {
    const prompt = createCardPrompt({
      lectureId: "lecture-1",
      title: "TCP",
      context: "Kursmål",
      sourceStatus:
        "Transkript: delvis.\nSlides: komplett tillgänglig slide-text är vald.",
      notes: "Egna noter",
      transcript: [
        { id: "s1", lectureId: "lecture-1", start: 1, end: 5, text: "Data" },
      ],
      markers: [
        {
          id: "m1",
          lectureId: "lecture-1",
          time: 32,
          note: "Särskilt viktigt",
          createdAt: "",
        },
      ],
      slideText: "Slide 1: Flödeskontroll",
      count: 10,
      types: ["basic"],
      preferences: ["Använd konkreta exempel."],
    });
    expect(prompt).toContain("Kursmål");
    expect(prompt).toContain("Egna noter");
    expect(prompt).toContain("Data");
    expect(prompt).toContain("Särskilt viktigt");
    expect(prompt).not.toContain("[1-5s]");
    expect(prompt).not.toContain("32s");
    expect(prompt).toContain("Slide 1: Flödeskontroll");
    expect(prompt).toContain("KÄLLTÄCKNING");
    expect(prompt).toContain("Slides: komplett tillgänglig slide-text är vald");
  });
});
