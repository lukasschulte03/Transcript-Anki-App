import type { ThemePalette } from "./types";

type SemanticColors = Pick<
  ThemePalette,
  | "success"
  | "successMuted"
  | "successForeground"
  | "warning"
  | "warningMuted"
  | "warningForeground"
  | "danger"
  | "dangerMuted"
  | "dangerForeground"
  | "info"
  | "infoMuted"
  | "infoForeground"
>;

type ThemeSeed = Omit<ThemePalette, keyof SemanticColors>;
type LegacyThemePalette = Partial<ThemePalette> & {
  primarySoft?: string;
  primarySoftHover?: string;
  primaryText?: string;
  accentText?: string;
  hero?: string;
  heroText?: string;
};

const lightSemantics: SemanticColors = {
  success: "#15803d",
  successMuted: "#dcfce7",
  successForeground: "#ffffff",
  warning: "#b45309",
  warningMuted: "#fef3c7",
  warningForeground: "#ffffff",
  danger: "#b91c1c",
  dangerMuted: "#fee2e2",
  dangerForeground: "#ffffff",
  info: "#1d4ed8",
  infoMuted: "#dbeafe",
  infoForeground: "#ffffff",
};

const darkSemantics: SemanticColors = {
  success: "#4ade80",
  successMuted: "#173525",
  successForeground: "#111827",
  warning: "#fbbf24",
  warningMuted: "#453814",
  warningForeground: "#111827",
  danger: "#f87171",
  dangerMuted: "#451f26",
  dangerForeground: "#111827",
  info: "#60a5fa",
  infoMuted: "#172f4d",
  infoForeground: "#111827",
};

function isDarkHex(color: string) {
  const hex = color.replace("#", "");
  if (!/^[\da-f]{6}$/i.test(hex)) return false;
  const [r, g, b] = [0, 2, 4].map((index) =>
    Number.parseInt(hex.slice(index, index + 2), 16),
  );
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

function createTheme(seed: ThemeSeed, overrides: Partial<SemanticColors> = {}) {
  return {
    ...seed,
    ...(isDarkHex(seed.background) ? darkSemantics : lightSemantics),
    ...overrides,
  } satisfies ThemePalette;
}

/** Every built-in theme uses the same semantic contract. */
export const builtInPalettes: ThemePalette[] = [
  createTheme({
    id: "chalk-neutral", name: "Kalk", background: "#ffffff", surface: "#ffffff",
    surfaceMuted: "#f4f4f5", surfaceHover: "#e4e4e7", text: "#18181b",
    textMuted: "#71717a", textSubtle: "#a1a1aa", border: "#e4e4e7",
    borderStrong: "#d4d4d8", primary: "#18181b", primaryHover: "#27272a",
    primaryMuted: "#f4f4f5", primaryMutedHover: "#e4e4e7", primaryForeground: "#fafafa",
    accent: "#27272a", focusRing: "#a1a1aa", heroBackground: "#18181b", heroForeground: "#fafafa",
  }),
  createTheme({
    id: "graphite", name: "Grafit", background: "#09090b", surface: "#18181b",
    surfaceMuted: "#27272a", surfaceHover: "#3f3f46", text: "#fafafa",
    textMuted: "#a1a1aa", textSubtle: "#71717a", border: "#27272a",
    borderStrong: "#3f3f46", primary: "#fafafa", primaryHover: "#e4e4e7",
    primaryMuted: "#27272a", primaryMutedHover: "#3f3f46", primaryForeground: "#18181b",
    accent: "#d4d4d8", focusRing: "#71717a", heroBackground: "#000000", heroForeground: "#fafafa",
  }),
  createTheme({
    id: "chalk", name: "Krita", background: "#f7f8fa", surface: "#ffffff",
    surfaceMuted: "#f1f5f9", surfaceHover: "#e9eef5", text: "#0f172a",
    textMuted: "#64748b", textSubtle: "#94a3b8", border: "#e2e8f0",
    borderStrong: "#cbd5e1", primary: "#7c3aed", primaryHover: "#6d28d9",
    primaryMuted: "#ede9fe", primaryMutedHover: "#ddd6fe", primaryForeground: "#ffffff",
    accent: "#5b21b6", focusRing: "#c4b5fd", heroBackground: "#0f172a", heroForeground: "#ffffff",
  }),
  createTheme({
    id: "fjord", name: "Fjord", background: "#f1f7f9", surface: "#fbfdfe",
    surfaceMuted: "#deedf2", surfaceHover: "#e7f1f4", text: "#102a35",
    textMuted: "#58727d", textSubtle: "#829ba5", border: "#c8dce3",
    borderStrong: "#a9c6cf", primary: "#087e8b", primaryHover: "#066874",
    primaryMuted: "#cdeff1", primaryMutedHover: "#b5e3e7", primaryForeground: "#ffffff",
    accent: "#055d67", focusRing: "#7fd1d7", heroBackground: "#123b4a", heroForeground: "#ffffff",
  }),
  createTheme({
    id: "paper", name: "Papper", background: "#f6f1e8", surface: "#fffaf0",
    surfaceMuted: "#eee6d8", surfaceHover: "#e8ddcc", text: "#312b24",
    textMuted: "#756b60", textSubtle: "#9a8c7d", border: "#ddd2c1",
    borderStrong: "#c7b9a4", primary: "#a34a28", primaryHover: "#873b20",
    primaryMuted: "#f5d8c8", primaryMutedHover: "#edc3ad", primaryForeground: "#ffffff",
    accent: "#7c351e", focusRing: "#dca486", heroBackground: "#3c2b1f", heroForeground: "#fffaf0",
  }),
  createTheme({
    id: "midnight", name: "Midnatt", background: "#0b1020", surface: "#151d31",
    surfaceMuted: "#1d2941", surfaceHover: "#23304a", text: "#eef2ff",
    textMuted: "#9ba9c6", textSubtle: "#7484a5", border: "#2d3a55",
    borderStrong: "#40506f", primary: "#8b7cf6", primaryHover: "#a79cff",
    primaryMuted: "#302b63", primaryMutedHover: "#3b3578", primaryForeground: "#0b1020",
    accent: "#c8c2ff", focusRing: "#7468df", heroBackground: "#070b16", heroForeground: "#eef2ff",
  }),
  createTheme({
    id: "forest", name: "Skog", background: "#0d1713", surface: "#17231e",
    surfaceMuted: "#203229", surfaceHover: "#24382e", text: "#edf7f1",
    textMuted: "#9ab5a6", textSubtle: "#6f8f7c", border: "#30483b",
    borderStrong: "#446151", primary: "#4fbd83", primaryHover: "#68d69a",
    primaryMuted: "#214c36", primaryMutedHover: "#2b6144", primaryForeground: "#07130d",
    accent: "#a1ebbd", focusRing: "#46a873", heroBackground: "#07110d", heroForeground: "#edf7f1",
  }, {
    // Green is the brand here; blue makes success distinct at a glance.
    success: "#60a5fa", successMuted: "#172f4d", successForeground: "#111827",
  }),
  createTheme({
    id: "plum", name: "Plommon", background: "#1b111c", surface: "#29192a",
    surfaceMuted: "#39213a", surfaceHover: "#442944", text: "#f8edf7",
    textMuted: "#c0a2bd", textSubtle: "#967493", border: "#50304f",
    borderStrong: "#684166", primary: "#dc72c2", primaryHover: "#ee91d6",
    primaryMuted: "#57234d", primaryMutedHover: "#6b2d5f", primaryForeground: "#25101f",
    accent: "#ffc6ef", focusRing: "#c55bad", heroBackground: "#160c17", heroForeground: "#f8edf7",
  }),
  createTheme({
    id: "catppuccin-latte", name: "Latte", background: "#eff1f5", surface: "#ffffff",
    surfaceMuted: "#e6e9ef", surfaceHover: "#dce0e8", text: "#4c4f69",
    textMuted: "#6c6f85", textSubtle: "#9ca0b0", border: "#ccd0da",
    borderStrong: "#bcc0cc", primary: "#8839ef", primaryHover: "#7832d2",
    primaryMuted: "#e0d5f4", primaryMutedHover: "#d0baf3", primaryForeground: "#ffffff",
    accent: "#58259b", focusRing: "#ac74f4", heroBackground: "#4c4f69", heroForeground: "#ffffff",
  }),
  createTheme({
    id: "catppuccin-frappe", name: "Frappé", background: "#232634", surface: "#292c3c",
    surfaceMuted: "#303446", surfaceHover: "#414559", text: "#c6d0f5",
    textMuted: "#a5adce", textSubtle: "#737994", border: "#51576d",
    borderStrong: "#626880", primary: "#ca9ee6", primaryHover: "#d2adea",
    primaryMuted: "#4f4966", primaryMutedHover: "#66597e", primaryForeground: "#232634",
    accent: "#cfa8e9", focusRing: "#d7b6ec", heroBackground: "#191b24", heroForeground: "#c6d0f5",
  }),
  createTheme({
    id: "catppuccin-macchiato", name: "Macchiato", background: "#181926", surface: "#1e2030",
    surfaceMuted: "#24273a", surfaceHover: "#363a4f", text: "#cad3f5",
    textMuted: "#a5adcb", textSubtle: "#6e738d", border: "#494d64",
    borderStrong: "#5b6078", primary: "#c6a0f6", primaryHover: "#cfaef7",
    primaryMuted: "#443f60", primaryMutedHover: "#5d517c", primaryForeground: "#181926",
    accent: "#ccaaf7", focusRing: "#d4b8f8", heroBackground: "#11121b", heroForeground: "#cad3f5",
  }),
  createTheme({
    id: "catppuccin-mocha", name: "Mocha", background: "#11111b", surface: "#181825",
    surfaceMuted: "#1e1e2e", surfaceHover: "#313244", text: "#cdd6f4",
    textMuted: "#a6adc8", textSubtle: "#6c7086", border: "#45475a",
    borderStrong: "#585b70", primary: "#cba6f7", primaryHover: "#d3b3f8",
    primaryMuted: "#413956", primaryMutedHover: "#5b4e74", primaryForeground: "#11111b",
    accent: "#d0aff8", focusRing: "#d8bcf9", heroBackground: "#0c0c13", heroForeground: "#cdd6f4",
  }),
  createTheme({
    id: "anthropic-claude-light", name: "Claude Light", background: "#f5f4ed", surface: "#ffffff",
    surfaceMuted: "#f0eee5", surfaceHover: "#e8e5d9", text: "#141413",
    textMuted: "#5a564d", textSubtle: "#8a8577", border: "#e3e0d3",
    borderStrong: "#d3cfbf", primary: "#c96442", primaryHover: "#b0532f",
    primaryMuted: "#f3ded2", primaryMutedHover: "#ecc9b5", primaryForeground: "#141413",
    accent: "#8a4022", focusRing: "#3898ec", heroBackground: "#141413", heroForeground: "#f5f4ed",
  }),
  createTheme({
    id: "anthropic-claude-dark", name: "Claude Dark", background: "#141413", surface: "#2b2a27",
    surfaceMuted: "#34322e", surfaceHover: "#3d3a35", text: "#f5f4ed",
    textMuted: "#a39e93", textSubtle: "#7d786c", border: "#3d3a35",
    borderStrong: "#4e4a43", primary: "#d97757", primaryHover: "#e2896c",
    primaryMuted: "#45332a", primaryMutedHover: "#56402f", primaryForeground: "#141413",
    accent: "#e2916f", focusRing: "#3898ec", heroBackground: "#000000", heroForeground: "#f5f4ed",
  }),
  createTheme({
    id: "openai-chatgpt-light", name: "ChatGPT Light", background: "#ffffff", surface: "#ffffff",
    surfaceMuted: "#f7f7f8", surfaceHover: "#ececf1", text: "#0f0f0f",
    textMuted: "#6e6e80", textSubtle: "#9b9ba8", border: "#e5e5e5",
    borderStrong: "#d0d0d5", primary: "#0f0f0f", primaryHover: "#2a2a2a",
    primaryMuted: "#ececf1", primaryMutedHover: "#dedee3", primaryForeground: "#ffffff",
    accent: "#10a37f", focusRing: "#10a37f", heroBackground: "#0f0f0f", heroForeground: "#ffffff",
  }),
  createTheme({
    id: "openai-chatgpt-dark", name: "ChatGPT Dark", background: "#171717", surface: "#212121",
    surfaceMuted: "#2f2f2f", surfaceHover: "#383838", text: "#ececec",
    textMuted: "#b4b4b4", textSubtle: "#8e8ea0", border: "#3f3f3f",
    borderStrong: "#525252", primary: "#ececec", primaryHover: "#ffffff",
    primaryMuted: "#2f2f2f", primaryMutedHover: "#383838", primaryForeground: "#171717",
    accent: "#10a37f", focusRing: "#10a37f", heroBackground: "#000000", heroForeground: "#ececec",
  }),
];

export const defaultCustomPalette = (): ThemePalette => ({
  ...builtInPalettes[0], id: crypto.randomUUID(), name: "Min palett",
});

/** Migrates legacy persisted custom palettes while returning the new contract. */
export function normalizePalette(
  palette: LegacyThemePalette & Pick<ThemePalette, "id" | "name">,
): ThemePalette {
  const fallback = builtInPalettes[0];
  const normalized = {
    ...fallback,
    ...palette,
    surfaceHover: palette.surfaceHover ?? palette.surfaceMuted ?? fallback.surfaceHover,
    textSubtle: palette.textSubtle ?? palette.textMuted ?? fallback.textSubtle,
    borderStrong: palette.borderStrong ?? palette.border ?? fallback.borderStrong,
    primaryMuted: palette.primaryMuted ?? palette.primarySoft ?? fallback.primaryMuted,
    primaryMutedHover: palette.primaryMutedHover ?? palette.primarySoftHover ?? palette.primaryMuted ?? palette.primarySoft ?? fallback.primaryMutedHover,
    primaryForeground: palette.primaryForeground ?? palette.primaryText ?? fallback.primaryForeground,
    accent: palette.accent ?? palette.accentText ?? palette.primary ?? fallback.accent,
    focusRing: palette.focusRing ?? palette.primaryMuted ?? palette.primarySoft ?? fallback.focusRing,
    heroBackground: palette.heroBackground ?? palette.hero ?? fallback.heroBackground,
    heroForeground: palette.heroForeground ?? palette.heroText ?? fallback.heroForeground,
  } as ThemePalette;
  return normalized;
}

export function resolvePalette(selectedId: string, customPalettes: ThemePalette[]) {
  return normalizePalette(
    customPalettes.find((palette) => palette.id === selectedId) ??
      builtInPalettes.find((palette) => palette.id === selectedId) ??
      builtInPalettes[0],
  );
}

export function isDarkPalette(palette: ThemePalette) {
  return isDarkHex(palette.background);
}

const requiredThemeKeys = [
  "background", "surface", "surfaceMuted", "surfaceHover", "text", "textMuted", "textSubtle",
  "border", "borderStrong", "primary", "primaryHover", "primaryMuted", "primaryMutedHover",
  "primaryForeground", "accent", "focusRing", "heroBackground", "heroForeground", "success",
  "successMuted", "successForeground", "warning", "warningMuted", "warningForeground", "danger",
  "dangerMuted", "dangerForeground", "info", "infoMuted", "infoForeground",
] as const satisfies readonly (keyof Omit<ThemePalette, "id" | "name">)[];

function relativeLuminance(color: string) {
  const hex = color.replace("#", "");
  if (!/^[\da-f]{6}$/i.test(hex)) return 0;
  const channels = [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string) {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

export function validateTheme(palette: ThemePalette): string[] {
  const errors = requiredThemeKeys
    .filter((key) => !palette[key])
    .map((key) => `${palette.name}: saknar ${key}`);
  const contrastPairs: [keyof ThemePalette, keyof ThemePalette][] = [
    ["primary", "primaryForeground"], ["success", "successForeground"],
    ["warning", "warningForeground"], ["danger", "dangerForeground"], ["info", "infoForeground"],
  ];
  contrastPairs.forEach(([background, foreground]) => {
    const ratio = contrastRatio(palette[background] as string, palette[foreground] as string);
    if (ratio < 4.5) errors.push(`${palette.name}: ${String(foreground)} på ${String(background)} har kontrast ${ratio.toFixed(2)}:1 (kräver 4.5:1)`);
  });
  return errors;
}

builtInPalettes.forEach((palette) => {
  const errors = validateTheme(palette);
  if (errors.length) console.warn("[Lectio theme validation]", errors);
});

export function applyPalette(palette: ThemePalette) {
  const root = document.documentElement;
  const dark = isDarkPalette(palette);
  root.dataset.palette = palette.id;
  root.dataset.paletteTone = dark ? "dark" : "light";
  root.classList.toggle("dark", dark);
  const values: Record<string, string> = {
    "--palette-background": palette.background, "--palette-surface": palette.surface,
    "--palette-surface-muted": palette.surfaceMuted, "--palette-surface-hover": palette.surfaceHover,
    "--palette-text": palette.text, "--palette-text-muted": palette.textMuted,
    "--palette-text-subtle": palette.textSubtle, "--palette-border": palette.border,
    "--palette-border-strong": palette.borderStrong, "--palette-primary": palette.primary,
    "--palette-primary-hover": palette.primaryHover, "--palette-primary-muted": palette.primaryMuted,
    "--palette-primary-muted-hover": palette.primaryMutedHover,
    "--palette-primary-foreground": palette.primaryForeground, "--palette-accent": palette.accent,
    "--palette-focus-ring": palette.focusRing, "--palette-hero-background": palette.heroBackground,
    "--palette-hero-foreground": palette.heroForeground, "--palette-success": palette.success,
    "--palette-success-muted": palette.successMuted, "--palette-success-foreground": palette.successForeground,
    "--palette-warning": palette.warning, "--palette-warning-muted": palette.warningMuted,
    "--palette-warning-foreground": palette.warningForeground, "--palette-danger": palette.danger,
    "--palette-danger-muted": palette.dangerMuted, "--palette-danger-foreground": palette.dangerForeground,
    "--palette-info": palette.info, "--palette-info-muted": palette.infoMuted,
    "--palette-info-foreground": palette.infoForeground,
    // shadcn/ui token bridge.
    "--background": palette.background, "--foreground": palette.text, "--card": palette.surface,
    "--card-foreground": palette.text, "--popover": palette.surface, "--popover-foreground": palette.text,
    "--primary": palette.primary, "--primary-foreground": palette.primaryForeground,
    "--secondary": palette.surfaceMuted, "--secondary-foreground": palette.text,
    "--muted": palette.surfaceMuted, "--muted-foreground": palette.textMuted,
    "--accent": palette.surfaceHover, "--accent-foreground": palette.text, "--destructive": palette.danger,
    "--destructive-foreground": palette.dangerForeground, "--border": palette.border,
    "--input": palette.borderStrong, "--ring": palette.focusRing, "--sidebar": palette.surface,
    "--sidebar-foreground": palette.text, "--sidebar-primary": palette.primary,
    "--sidebar-primary-foreground": palette.primaryForeground, "--sidebar-accent": palette.surfaceHover,
    "--sidebar-accent-foreground": palette.text, "--sidebar-border": palette.border,
    "--sidebar-ring": palette.focusRing,
  };
  Object.entries(values).forEach(([name, value]) => root.style.setProperty(name, value));
}
