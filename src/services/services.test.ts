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
  duplicateExplanation,
  generateCardsWithApi,
  aiModelSuggestions,
  parseCardResponse,
} from "./ai";
import { parseWhisperJson } from "./localStt";
import { hasClozeMarkup, lectureDeckName, needsAnkiSync, syncCard, testAnki, withoutStructuralTags } from "./anki";
import { builtInPalettes, validateTheme } from "../core/theme";
import { suggestSlideMappings } from "./slideMatching";
import { diagnosticSuggestions, redactDiagnosticText } from "./diagnostics";
import { canRecoverRecording } from "./recordingRecovery";
import { recommendLocalTranscription } from "./transcriptionRecommendation";
import { isLikelySameGoogleDriveLibrary } from "./googleDriveSync";
import { mergeLibrarySnapshots } from "./libraryMerge";
import type { LibrarySyncSnapshot } from "./libraryMerge";
import { estimateTranscriptionCost, formatTranscriptionCost } from "./transcriptionCost";

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
    expect(diagnosticSuggestions([{ at: "now", area: "app", message: "Command plugin:opener|open_url not allowed by ACL" }])[0])
      .toContain("senaste Lectio-versionen");
  });
});

describe("Google Drive-synk", () => {
  it("känner igen ett återställt bibliotek med samma interna objekt-ID", () => {
    const library = {
      nodes: [
        { id: "workspace", type: "workspace" },
        { id: "course-1", type: "course" },
      ],
      lectures: { "lecture-1": { id: "lecture-1" } },
    } as never;

    expect(isLikelySameGoogleDriveLibrary(library, library, [], [])).toBe(true);
  });

  it("tar inte workspace-noden som bevis för att två bibliotek är samma", () => {
    const local = {
      nodes: [
        { id: "workspace", type: "workspace" },
        { id: "course-local", type: "course" },
      ],
      lectures: {},
    } as never;
    const remote = {
      nodes: [
        { id: "workspace", type: "workspace" },
        { id: "course-remote", type: "course" },
      ],
      lectures: {},
    } as never;

    expect(isLikelySameGoogleDriveLibrary(local, remote, [], [])).toBe(false);
  });

  it("förenar PC:ns nya transkript med laptopens nya föreläsning", () => {
    const base = {
      nodes: [
        { id: "workspace", type: "workspace", parentId: null, title: "Studier", context: "", createdAt: "", settings: {} },
        { id: "lecture-a", type: "lecture", parentId: "workspace", title: "A", context: "", createdAt: "", settings: {} },
      ],
      lectures: { "lecture-a": { lectureId: "lecture-a", notes: "" } },
      segments: [], markers: [], cards: [], pendingAnkiDeletions: [], settings: {} as AppSettings,
    } satisfies LibrarySyncSnapshot;
    const local = { ...base, segments: [{ id: "segment-a", lectureId: "lecture-a", start: 0, end: 2, text: "PC-transkript" }] };
    const remote = {
      ...base,
      nodes: [...base.nodes, { id: "lecture-b", type: "lecture" as const, parentId: "workspace", title: "B", context: "", createdAt: "", settings: {} }],
      lectures: { ...base.lectures, "lecture-b": { lectureId: "lecture-b", notes: "Laptopens slides" } },
    };
    const result = mergeLibrarySnapshots(base, local, remote);
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot.segments[0]?.text).toBe("PC-transkript");
    expect(result.snapshot.lectures["lecture-b"]?.notes).toBe("Laptopens slides");
  });

  it("flaggar när samma fält ändrats olika på två datorer", () => {
    const base = { nodes: [], lectures: { lecture: { lectureId: "lecture", notes: "Bas" } }, segments: [], markers: [], cards: [], pendingAnkiDeletions: [], settings: {} as AppSettings } satisfies LibrarySyncSnapshot;
    const result = mergeLibrarySnapshots(
      base,
      { ...base, lectures: { lecture: { lectureId: "lecture", notes: "PC" } } },
      { ...base, lectures: { lecture: { lectureId: "lecture", notes: "Laptop" } } },
    );
    expect(result.conflicts).toContainEqual(expect.objectContaining({ collection: "föreläsningar", field: "notes" }));
  });
});

describe("biblioteksträd", () => {
  const node = (id: string, type: LibraryNode["type"], parentId: string | null, sortIndex: number): LibraryNode => ({
    id, type, parentId, sortIndex, title: id, context: "", createdAt: "", settings: {},
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
    expect(moved.filter((item) => item.parentId === "course-b").sort((a, b) => a.sortIndex! - b.sortIndex!).map((item) => [item.id, item.sortIndex]))
      .toEqual([["module-b", 0], ["module-a", 1]]);

    const reordered = reorderLibraryNode(tree, "course-b", "course-a");
    expect(reordered.filter((item) => item.parentId === "workspace").sort((a, b) => a.sortIndex! - b.sortIndex!).map((item) => [item.id, item.sortIndex]))
      .toEqual([["course-b", 0], ["course-a", 1]]);
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
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      text: "Mockad transkription",
      segments: [{ start: 0, end: 3, text: "Mockad transkription" }],
    }), { status: 200 }));
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
      { start: 2, end: 8, text: "detta är en viktig fras detta är en viktig fras" },
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
    expect(estimateTranscriptionCost("groq", "egen-modell", 600).usd).toBeUndefined();
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
      engine: { cpuThreads: 8, nvidiaDetected: false, nvidiaName: null, nvidiaRuntimeInstalled: false, nvidiaRuntimeReady: false, nvidiaRuntimeSize: 0, nvidiaVramTotalMb: null },
      benchmarks: {
        cpu: {
          model: "base", acceleration: "cpu", realtimeFactor: 0.1,
          durationSeconds: 20, elapsedSeconds: 2, gpuUsed: false, measuredAt: "now",
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
      [{ id: "one", lectureId: "lecture", start: 0, end: 4, text: "patientens anamnes diskuterades" }],
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
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"cards":[]}' } }],
    }), { status: 200 }));
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
      generateCardsWithApi("Skapa kort", { ...settings, aiBaseUrl: "" }, "testnyckel"),
    ).rejects.toThrow("bas-URL");
  });

  it("bygger en kompakt prompt utan instruktioner för otillåtna korttyper", () => {
    const prompt = createCardPrompt({
      lectureId: "lecture",
      title: "Akut buk",
      context: "",
      notes: "",
      transcript: [],
      markers: [],
      slideText: "",
      count: 12,
      types: ["basic", "concept"],
      preferences: [],
      existingCards: [{ front: "Vad är peritonit?", back: "Inflammation i peritoneum." }],
    });
    expect(prompt).toContain("BEFINTLIGA KORT I KURSEN");
    expect(prompt).toContain("Vad är peritonit?");
    expect(prompt).toContain("Promptversion: 1");
    expect(prompt).toContain("Använd endast uttryckligt källstöd");
    expect(prompt).toContain('"type":"basic|concept"');
    expect(prompt).toContain("basic: en tydlig fråga");
    expect(prompt).toContain("concept: testa ett samband");
    expect(prompt).not.toContain("cloze: front måste");
    expect(prompt).not.toContain("problem: testa en konkret");
    expect(prompt).not.toContain("Terminologi: Vad");
    expect(duplicateExplanation("Vad är akut peritonit?", { front: "Vad är peritonit?" })).toContain("peritonit");
  });

  it("beskriver endast cloze-regler när cloze har valts", () => {
    const prompt = createCardPrompt({
      lectureId: "lecture", title: "Akut buk", context: "", notes: "", transcript: [], markers: [], slideText: "",
      count: 12, types: ["cloze"], preferences: [],
    });
    expect(prompt).toContain("cloze: front måste innehålla minst en giltig {{c1::...}}-markering");
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
    expect(needsAnkiSync({ ...card, status: "approved" }, card.ankiDeck)).toBe(true);
  });

  it("skapar ett Basic-kort via en mockad AnkiConnect utan extern app", async () => {
    const requests: Array<{ action: string; params: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { action: string; params: Record<string, unknown> };
      requests.push(body);
      const result = body.action === "modelFieldNames" ? ["Front", "Back"] : 123;
      return new Response(JSON.stringify({ result, error: null }), { status: 200 });
    }));
    const noteId = await syncCard("http://127.0.0.1:8765", "Kirurgi - Lectio", {
      id: "card", lectureId: "lecture", type: "basic", front: "Fråga", back: "Svar", tags: ["tentamen"], status: "approved",
    });
    expect(noteId).toBe(123);
    expect(requests.map((request) => request.action)).toEqual(["modelFieldNames", "addNote"]);
    expect(requests[1].params).toMatchObject({ note: { deckName: "Kirurgi - Lectio", fields: { Front: "Fråga", Back: "Svar" } } });
  });

  it("skapar ett Cloze-kort med Ankis Text- och Extra-fält", async () => {
    const requests: Array<{ action: string; params: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { action: string; params: Record<string, unknown> };
      requests.push(body);
      const result = body.action === "modelFieldNames" ? ["Text", "Extra"] : 321;
      return new Response(JSON.stringify({ result, error: null }), { status: 200 });
    }));

    await expect(syncCard("http://127.0.0.1:8765", "Kirurgi - Lectio", {
      id: "cloze", lectureId: "lecture", type: "cloze",
      front: "Blodets pH hålls stabilt av {{c1::buffertsystem}}.", back: "Viktig princip.",
      tags: [], status: "approved",
    })).resolves.toBe(321);
    expect(requests.map((request) => request.action)).toEqual(["modelFieldNames", "addNote"]);
    expect(requests[1].params).toMatchObject({ note: {
      modelName: "Cloze",
      fields: { Text: "Blodets pH hålls stabilt av {{c1::buffertsystem}}.", Extra: "Viktig princip." },
    } });
  });

  it("stoppar ett Cloze-kort utan Anki-markering innan det skickas", async () => {
    await expect(syncCard("http://127.0.0.1:8765", "Lectio", {
      id: "invalid-cloze", lectureId: "lecture", type: "cloze",
      front: "Vilket system stabiliserar blodets pH?", back: "Buffertsystem.",
      tags: [], status: "approved",
    })).rejects.toThrow("saknar Anki-markering");
    expect(hasClozeMarkup("{{c1::buffertsystem}}")).toBe(true);
    expect(hasClozeMarkup("Buffertsystem")).toBe(false);
  });

  it("ersätter säkert en synkad Basic-not när kortet ändras till Cloze", async () => {
    const requests: Array<{ action: string; params: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { action: string; params: Record<string, unknown> };
      requests.push(body);
      const result = body.action === "modelFieldNames" ? ["Text", "Extra"]
        : body.action === "notesInfo" ? [{ modelName: "Basic", tags: ["lectio"] }]
        : body.action === "addNote" ? 987
        : null;
      return new Response(JSON.stringify({ result, error: null }), { status: 200 });
    }));

    await expect(syncCard("http://127.0.0.1:8765", "Lectio", {
      id: "changed", lectureId: "lecture", type: "cloze", ankiId: 42,
      front: "Detta är {{c1::ett cloze-kort}}.", back: "Förklaring.",
      tags: [], status: "approved",
    })).resolves.toBe(987);
    expect(requests.map((request) => request.action)).toEqual([
      "modelFieldNames", "notesInfo", "addNote", "deleteNotes",
    ]);
  });

  it("kan försöka om en misslyckad Anki-synk mot samma lokala mock", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      attempts++;
      if (attempts === 1) return new Response("Tillfälligt fel", { status: 503 });
      const body = JSON.parse(String(init.body)) as { action: string };
      const result = body.action === "modelFieldNames" ? ["Front", "Back"] : 456;
      return new Response(JSON.stringify({ result, error: null }), { status: 200 });
    }));
    const card = {
      id: "retry-card", lectureId: "lecture", type: "basic" as const,
      front: "Fråga", back: "Svar", tags: [], status: "approved" as const,
    };

    await expect(syncCard("http://127.0.0.1:8765", "Lectio", card)).rejects.toThrow("503");
    await expect(syncCard("http://127.0.0.1:8765", "Lectio", card)).resolves.toBe(456);
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
      notes: "Egna noter",
      transcript: [
        { id: "s1", lectureId: "lecture-1", start: 1, end: 5, text: "Data" },
      ],
      markers: [{ id: "m1", lectureId: "lecture-1", time: 32, note: "Särskilt viktigt", createdAt: "" }],
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
  });
});
