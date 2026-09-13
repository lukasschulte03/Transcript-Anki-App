import { describe, expect, it } from "vitest";
import { resolveRuntimeProfile } from "./runtimeProfile";

describe("frontend och dataprofil", () => {
  it("isolerar Next som standard utan att ändra legacyprofilen", () => {
    expect(resolveRuntimeProfile("legacy")).toBe("main");
    expect(resolveRuntimeProfile("next")).toBe("next");
  });

  it("håller frontendval och explicit dataprofil separata", () => {
    expect(resolveRuntimeProfile("next", "main")).toBe("main");
    expect(resolveRuntimeProfile("legacy", "next")).toBe("next");
    expect(resolveRuntimeProfile("legacy", "main", true)).toBe("stability");
  });
});
