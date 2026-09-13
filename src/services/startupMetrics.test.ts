import { describe, expect, it } from "vitest";
import {
  finishStartupPhase,
  markStartup,
  startStartupPhase,
  startupTimings,
} from "./startupMetrics";

describe("startup metrics", () => {
  it("records milestones only once", () => {
    const stage = `unit-milestone-${Date.now()}`;
    markStartup(stage);
    markStartup(stage);
    expect(startupTimings().filter((item) => item.stage === stage)).toHaveLength(1);
  });

  it("records phase duration and result", () => {
    const stage = `unit-phase-${Date.now()}`;
    startStartupPhase(stage);
    finishStartupPhase(stage, "ok");
    const timing = startupTimings().find(
      (item) => item.stage === `${stage}:complete`,
    );
    expect(timing).toMatchObject({ result: "ok" });
    expect(timing?.durationMs).toBeGreaterThanOrEqual(0);
  });
});
