import { describe, expect, it } from "vitest";
import {
  buildTranscriptionPrompt,
  parseTimestampedText,
} from "./transcription";
import { createCardPrompt, parseCardResponse } from "./ai";
import { parseWhisperJson } from "./localStt";
import { lectureDeckName, needsAnkiSync, withoutStructuralTags } from "./anki";
import { builtInPalettes, validateTheme } from "../core/theme";
import { suggestSlideMappings } from "./slideMatching";

describe("teman", () => {
  it("har komplett kontrastvaliderad tokenuppsättning", () => {
    expect(builtInPalettes.flatMap(validateTheme)).toEqual([]);
  });
});

describe("transkriptimport", () => {
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
  it("flaggar sannolika Whisper-upprepningar för granskning", () => {
    const result = parseWhisperJson(
      '{"transcription":[{"offsets":{"from":0,"to":4000},"text":"Det här viktiga begreppet kommer på tentamen."},{"offsets":{"from":4000,"to":8000},"text":"Det här viktiga begreppet kommer på tentamen."}]}',
    );
    expect(result.segments[1].suspicious).toBe(true);
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
});

describe("kortformat", () => {
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
      markers: [],
      slideText: "Slide 1: Flödeskontroll",
      count: 10,
      types: ["basic"],
      preferences: ["Använd konkreta exempel."],
    });
    expect(prompt).toContain("Kursmål");
    expect(prompt).toContain("Egna noter");
    expect(prompt).toContain("[1-5s] Data");
    expect(prompt).toContain("Slide 1: Flödeskontroll");
  });
});
