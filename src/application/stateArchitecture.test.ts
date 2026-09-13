import { beforeEach, describe, expect, it } from "vitest";
import type { LibraryNode } from "../core/types";
import { useAppStore } from "../core/store";
import { useJobStore } from "../infrastructure/jobStore";
import { persistedAppState } from "../infrastructure/persistence";
import {
  canMoveLibraryNode,
  moveLibraryNode,
  reorderLibraryNode,
} from "../domain/libraryTree";

const node = (
  id: string,
  type: LibraryNode["type"],
  parentId: string | null,
  sortIndex = 0,
): LibraryNode => ({
  id,
  type,
  parentId,
  sortIndex,
  title: id,
  context: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  settings: {},
});

describe("state architecture", () => {
  beforeEach(() => useJobStore.getState().clearJobs());

  it("keeps transient jobs outside the durable application snapshot", () => {
    const before = useAppStore.getState();
    useJobStore.getState().upsertJob({
      id: "transcription:test",
      kind: "transcription",
      label: "Test",
      phase: "transcribing",
      status: "active",
      current: 1,
    });

    expect(useAppStore.getState()).toBe(before);
    expect(useJobStore.getState().jobs).toHaveLength(1);
    expect(Object.keys(persistedAppState(before))).not.toContain("jobs");
    expect(JSON.stringify(persistedAppState(before))).not.toContain(
      "upsertJob",
    );
  });

  it("keeps library moves pure and rejects invalid hierarchy changes", () => {
    const nodes = [
      node("root", "workspace", null),
      node("a", "course", "root", 0),
      node("b", "course", "root", 1),
      node("m", "module", "a"),
      node("l1", "lecture", "m", 0),
      node("l2", "lecture", "m", 1),
    ];

    expect(canMoveLibraryNode(nodes, "m", "b")).toBe(true);
    expect(canMoveLibraryNode(nodes, "a", "m")).toBe(false);
    expect(moveLibraryNode(nodes, "m", "b")).not.toBe(nodes);
    expect(moveLibraryNode(nodes, "a", "m")).toBe(nodes);
    expect(reorderLibraryNode(nodes, "l2", "l1").find((n) => n.id === "l2")?.sortIndex).toBe(0);
  });
});
