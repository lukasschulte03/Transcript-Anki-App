import { describe, expect, it } from "vitest";
import type { LibrarySnapshot } from "../../application/lectioClient";
import {
  buildSuperActionEligibility,
  selectableSuperActionLectureIds,
} from "./superActionsEligibility";

const lectureNode = {
  id: "l1",
  type: "lecture" as const,
  parentId: null,
  title: "L1",
  context: "",
  createdAt: "",
  settings: {},
};

function library(overrides: Partial<LibrarySnapshot> = {}): LibrarySnapshot {
  return {
    nodes: [lectureNode],
    lectures: {},
    segments: [],
    markers: [],
    cards: [],
    ...overrides,
  };
}

describe("Super Actions eligibility", () => {
  it("selects completed eligible lectures only when overwrite is enabled", () => {
    const eligible = new Map([
      ["done", null],
      ["new", null],
      ["blocked", "Saknar ljud"],
    ]);
    const isComplete = (id: string) => id === "done";
    expect(
      selectableSuperActionLectureIds(
        ["done", "new", "blocked"],
        eligible,
        isComplete,
        false,
      ),
    ).toEqual(["new"]);
    expect(
      selectableSuperActionLectureIds(
        ["done", "new", "blocked"],
        eligible,
        isComplete,
        true,
      ),
    ).toEqual(["done", "new"]);
  });

  it("requires audio for transcription", () => {
    expect(buildSuperActionEligibility("transcribe", library()).get("l1")).toBe(
      "Saknar ljud",
    );
    const result = library({
      lectures: { l1: { lectureId: "l1", notes: "", audioAssetId: "audio-1" } },
    });
    expect(
      buildSuperActionEligibility("transcribe", result).get("l1"),
    ).toBeNull();
  });

  it("requires slides for image extraction", () => {
    expect(
      buildSuperActionEligibility("extractImages", library()).get("l1"),
    ).toBe("Saknar slides");
    const withSlides = library({
      lectures: { l1: { lectureId: "l1", notes: "", slideAssetId: "slides-1" } },
    });
    expect(
      buildSuperActionEligibility("extractImages", withSlides).get("l1"),
    ).toBeNull();
  });

  it("requires indexed crops before describing images", () => {
    expect(
      buildSuperActionEligibility("describeImages", library()).get("l1"),
    ).toBe("Inga extraherade bilder");
    const withImages = library({
      lectures: {
        l1: {
          lectureId: "l1",
          notes: "",
          visualIndex: [
            {
              id: "v1",
              slidePage: 1,
              description: "Bildutklipp",
              keywords: [],
              sourceHash: "hash",
            },
          ],
        },
      },
    });
    expect(
      buildSuperActionEligibility("describeImages", withImages).get("l1"),
    ).toBeNull();
  });

  it("accepts any real lecture source for generation", () => {
    expect(
      buildSuperActionEligibility("generate", library()).get("l1"),
    ).toMatch(/Saknar material/);
    const withNotes = library({
      lectures: { l1: { lectureId: "l1", notes: "Course notes" } },
    });
    expect(
      buildSuperActionEligibility("generate", withNotes).get("l1"),
    ).toBeNull();
    const withTranscript = library({
      segments: [
        { id: "s1", lectureId: "l1", start: 0, end: 1, text: "Transcript" },
      ],
    });
    expect(
      buildSuperActionEligibility("generate", withTranscript).get("l1"),
    ).toBeNull();
  });

  it("requires at least one card for card actions", () => {
    for (const action of ["approve", "sync", "delete"] as const) {
      expect(buildSuperActionEligibility(action, library()).get("l1")).toBe(
        "Inga Anki-kort",
      );
      const withCard = library({
        cards: [
          {
            id: "c1",
            lectureId: "l1",
            type: "basic",
            front: "Q",
            back: "A",
            tags: [],
            status: "synced",
          },
        ],
      });
      expect(
        buildSuperActionEligibility(action, withCard).get("l1"),
      ).toBeNull();
    }
  });

  it("does not offer sync when cards exist but none are approved", () => {
    const generatedCard = library({
      cards: [
        {
          id: "c1",
          lectureId: "l1",
          type: "basic",
          front: "Q",
          back: "A",
          tags: [],
          status: "generated",
        },
      ],
    });
    expect(buildSuperActionEligibility("sync", generatedCard).get("l1")).toBe(
      "Inga godkända kort att synka",
    );
  });
});
