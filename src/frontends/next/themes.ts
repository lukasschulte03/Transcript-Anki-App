import type { CSSProperties } from "react";
import type { ThemePalette } from "../../application/lectioClient";
import {
  builtInPalettes,
  isDarkPalette,
  resolvePalette,
} from "../../application/themeCatalog";

export type NextThemePreset = {
  palette: ThemePalette;
  tone: "light" | "dark";
  family: "blue" | "orange";
  chrome: [string, string, string];
};

const chromeById: Record<string, [string, string, string]> = {
  "blue-light": ["#9bc8ef", "#73a7dc", "#6679c7"],
  "orange-light": ["#f6b17e", "#e87d5b", "#bd5367"],
  // Dark chrome still carries a visible hue: three neighboring blue/orange
  // shades, stepping down in brightness without fading toward black.
  "blue-dark": ["#2b4f6d", "#234361", "#1b3651"],
  "orange-dark": ["#71452f", "#623824", "#512d20"],
};

export const nextThemePresets: NextThemePreset[] = builtInPalettes.map(
  (palette) => ({
    palette,
    tone: isDarkPalette(palette) ? "dark" : "light",
    family: palette.id.startsWith("orange") ? "orange" : "blue",
    chrome: chromeById[palette.id] ?? chromeById["blue-light"],
  }),
);

export function resolveNextTheme(selectedId: string): NextThemePreset {
  const palette = resolvePalette(selectedId, []);
  return (
    nextThemePresets.find((preset) => preset.palette.id === palette.id) ??
    nextThemePresets[0]
  );
}

export function nextThemeStyle(theme: NextThemePreset): CSSProperties {
  const { palette, chrome, tone } = theme;
  const dark = tone === "dark";
  return {
    colorScheme: tone,
    "--arc-coral": chrome[0],
    "--arc-rose": chrome[1],
    "--arc-plum": chrome[2],
    "--arc-deep": palette.primary,
    "--arc-ink": palette.text,
    "--arc-muted": palette.textMuted,
    // The authored light-palette subtle tones are decorative-level colors.
    // Normal-sized helper text needs the stronger muted token for WCAG AA.
    "--arc-subtle": dark ? palette.textSubtle : palette.textMuted,
    // Keep the authored palette in the surrounding chrome, while the active
    // workspace reads as a document material. This separation is what makes
    // the single-canvas model legible in both bright and dark palettes.
    "--arc-page": palette.background,
    "--arc-paper": palette.surface,
    "--arc-raised": palette.surface,
    "--arc-muted-paper": palette.surfaceMuted,
    // A shared, low-emphasis material used by list hover states, icons and
    // quiet status surfaces. Keep it palette-derived so it works in both tones.
    "--arc-soft": palette.surfaceMuted,
    "--arc-line": palette.border,
    "--arc-line-strong": palette.borderStrong,
    "--arc-focus": palette.focusRing,
    "--arc-chrome-ink": dark ? "#ffffff" : "#101820",
    "--arc-chrome-muted": dark
      ? "rgba(255, 255, 255, 0.7)"
      : "rgba(16, 24, 32, 0.7)",
    "--arc-chrome-control": dark
      ? "rgba(255, 255, 255, 0.1)"
      : "rgba(12, 28, 42, 0.1)",
    "--arc-chrome-hover": dark
      ? "rgba(255, 255, 255, 0.16)"
      : "rgba(12, 28, 42, 0.16)",
    "--arc-chrome-selected": dark
      ? "rgba(255, 255, 255, 0.16)"
      : "rgba(12, 28, 42, 0.16)",
    "--arc-overlay": dark
      ? "rgba(23, 34, 44, 0.82)"
      : "rgba(255, 255, 255, 0.82)",
    "--arc-overlay-strong": dark
      ? "rgba(23, 34, 44, 0.94)"
      : "rgba(255, 255, 255, 0.94)",
    "--arc-canvas-shadow": dark
      ? "rgba(0, 0, 0, 0.42)"
      : "rgba(10, 18, 26, 0.18)",
    "--arc-canvas-shadow-strong": dark
      ? "rgba(0, 0, 0, 0.58)"
      : "rgba(10, 18, 26, 0.28)",
    "--arc-selection": palette.primaryMuted,
    "--palette-background": palette.background,
    "--palette-surface": palette.surface,
    "--palette-surface-muted": palette.surfaceMuted,
    "--palette-surface-hover": palette.surfaceHover,
    "--palette-text": palette.text,
    "--palette-text-muted": palette.textMuted,
    "--palette-text-subtle": palette.textSubtle,
    "--palette-border": palette.border,
    "--palette-border-strong": palette.borderStrong,
    "--palette-primary": palette.primary,
    "--palette-primary-hover": palette.primaryHover,
    "--palette-primary-muted": palette.primaryMuted,
    "--palette-primary-muted-hover": palette.primaryMutedHover,
    "--palette-primary-foreground": palette.primaryForeground,
    "--palette-accent": palette.accent,
    "--palette-focus-ring": palette.focusRing,
    "--palette-danger": palette.danger,
    "--palette-danger-muted": palette.dangerMuted,
    "--palette-danger-foreground": palette.dangerForeground,
    "--palette-warning": palette.warning,
    "--palette-warning-muted": palette.warningMuted,
    "--palette-warning-foreground": palette.warningForeground,
    "--palette-success": palette.success,
    "--palette-success-muted": palette.successMuted,
    "--palette-success-foreground": palette.successForeground,
    "--palette-info": palette.info,
    "--palette-info-muted": palette.infoMuted,
    "--palette-info-foreground": palette.infoForeground,
  } as CSSProperties;
}
