import { describe, expect, it } from "vitest";
import { builtInPalettes, validateTheme } from "./theme";

describe("built-in themes", () => {
  it("only exposes the four authored light and dark presets", () => {
    expect(builtInPalettes.map((palette) => palette.id)).toEqual([
      "blue-light",
      "orange-light",
      "blue-dark",
      "orange-dark",
    ]);
  });

  it("keeps all semantic foreground pairs WCAG-valid", () => {
    expect(
      builtInPalettes.flatMap((palette) => validateTheme(palette)),
    ).toEqual([]);
  });
});
