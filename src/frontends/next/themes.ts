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
  "blue-dark": ["#142a43", "#17466b", "#33345f"],
  "orange-dark": ["#3a1d18", "#71311f", "#8e4829"],
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
    "--arc-subtle": palette.textSubtle,
    "--arc-paper": palette.background,
    "--arc-raised": palette.surface,
    "--arc-muted-paper": palette.surfaceMuted,
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
      ? "rgba(255, 255, 255, 0.22)"
      : "rgba(12, 28, 42, 0.22)",
    "--arc-overlay": dark
      ? "rgba(23, 34, 44, 0.72)"
      : "rgba(255, 255, 255, 0.72)",
    "--arc-overlay-strong": dark
      ? "rgba(23, 34, 44, 0.94)"
      : "rgba(255, 255, 255, 0.94)",
    "--arc-canvas-shadow": dark
      ? "rgba(0, 0, 0, 0.48)"
      : "rgba(10, 18, 26, 0.24)",
    "--arc-canvas-shadow-strong": dark
      ? "rgba(0, 0, 0, 0.68)"
      : "rgba(10, 18, 26, 0.34)",
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
    "--palette-warning": palette.warning,
    "--palette-warning-muted": palette.warningMuted,
    "--palette-success": palette.success,
    "--palette-success-muted": palette.successMuted,
  } as CSSProperties;
}
