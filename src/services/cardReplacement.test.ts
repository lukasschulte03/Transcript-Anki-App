import { describe, expect, it } from "vitest";
import type { Flashcard } from "../core/types";
import { commitCardReplacement, planCardReplacement } from "./cardReplacement";

const card = (id: string, lectureId: string): Flashcard => ({
  id,
  lectureId,
  type: "basic",
  front: `Question ${id}`,
  back: `Answer ${id}`,
  tags: [],
  status: "generated",
});

describe("batch card replacement", () => {
  it("retains existing cards when overwrite is off", () => {
    const plan = planCardReplacement(
      [card("old", "lecture-a")],
      "lecture-a",
      false,
    );
    expect(plan.referenceCards.map((item) => item.id)).toEqual(["old"]);
    expect(plan.replacedCardIds).toEqual([]);
  });

  it("replaces only cards belonging to the generated lecture", () => {
    const plan = planCardReplacement(
      [card("target", "lecture-a"), card("other", "lecture-b")],
      "lecture-a",
      true,
    );
    expect(plan.referenceCards.map((item) => item.id)).toEqual(["other"]);
    expect(plan.replacedCardIds).toEqual(["target"]);
  });

  it("keeps old cards if generation returns no usable cards", () => {
    const removed: string[] = [];
    const added: unknown[] = [];
    const plan = planCardReplacement(
      [card("old", "lecture-a")],
      "lecture-a",
      true,
    );
    const replaced = commitCardReplacement(plan, [], {
      addCards: (cards) => {
        added.push(...cards);
        return [];
      },
      removeCard: (id) => removed.push(id),
    });
    expect(replaced).toBe(false);
    expect(added).toEqual([]);
    expect(removed).toEqual([]);
  });

  it("adds successful replacements before removing old cards", () => {
    const events: string[] = [];
    const plan = planCardReplacement(
      [card("old", "lecture-a")],
      "lecture-a",
      true,
    );
    const replaced = commitCardReplacement(
      plan,
      [
        {
          lectureId: "lecture-a",
          type: "basic",
          front: "New question",
          back: "New answer",
          tags: [],
          status: "generated",
        },
      ],
      {
        addCards: () => {
          events.push("add");
          return ["new"];
        },
        removeCard: (id) => events.push(`remove:${id}`),
      },
    );
    expect(replaced).toBe(true);
    expect(events).toEqual(["add", "remove:old"]);
  });
});
