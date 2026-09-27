import { describe, expect, it } from "vitest";
import { builtInPalettes } from "../../core/theme";
import { nextThemePresets, nextThemeStyle } from "./themes";

function luminance(color: string) {
  const hex = color.replace("#", "");
  const channels = [0, 2, 4].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground: string, background: string) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

describe("Next palette bridge", () => {
  it("uses related chromatic stops for dark ambient backgrounds", () => {
    for (const theme of nextThemePresets.filter(
      (preset) => preset.tone === "dark",
    )) {
      const luminances = theme.chrome.map(luminance);
      expect(luminances[0]).toBeGreaterThan(luminances[1]);
      expect(luminances[1]).toBeGreaterThan(luminances[2]);

      for (const color of theme.chrome) {
        const hex = color.slice(1);
        const channels = [0, 2, 4].map((offset) =>
          Number.parseInt(hex.slice(offset, offset + 2), 16),
        );
        const maximum = Math.max(...channels);
        const minimum = Math.min(...channels);
        expect(maximum).toBeGreaterThan(40);
        expect((maximum - minimum) / maximum).toBeGreaterThan(0.25);
      }
    }
  });

  it("maps every surface and semantic foreground from the active palette", () => {
    for (const palette of builtInPalettes) {
      const theme = nextThemePresets.find(
        (preset) => preset.palette.id === palette.id,
      )!;
      const style = nextThemeStyle(theme) as Record<string, unknown>;

      expect(style["--arc-soft"]).toBe(palette.surfaceMuted);
      expect(style["--palette-danger-foreground"]).toBe(
        palette.dangerForeground,
      );
      expect(style["--palette-warning-foreground"]).toBe(
        palette.warningForeground,
      );
      expect(style["--palette-success-foreground"]).toBe(
        palette.successForeground,
      );
      expect(style["--palette-info-foreground"]).toBe(palette.infoForeground);
      expect(style["--arc-subtle"]).toBe(
        theme.tone === "dark" ? palette.textSubtle : palette.textMuted,
      );
    }
  });

  it("keeps normal and supporting text legible on all workspace surfaces", () => {
    for (const palette of builtInPalettes) {
      expect(contrast(palette.text, palette.background)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast(palette.text, palette.surface)).toBeGreaterThanOrEqual(
        4.5,
      );
      for (const surface of [
        palette.background,
        palette.surface,
        palette.surfaceMuted,
      ]) {
        expect(contrast(palette.textMuted, surface)).toBeGreaterThanOrEqual(
          4.5,
        );
      }

      if (palette.id.endsWith("-dark")) {
        expect(
          contrast(palette.textSubtle, palette.background),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
