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
    id: "blue-light",
    name: "Himmel",
    background: "#edf4fa",
    surface: "#fbfdff",
    surfaceMuted: "#e3edf6",
    surfaceHover: "#d7e6f2",
    text: "#14283b",
    textMuted: "#526b80",
    textSubtle: "#7890a3",
    border: "#ccdae6",
    borderStrong: "#adbfce",
    primary: "#245f9e",
    primaryHover: "#194f88",
    primaryMuted: "#d7e8f7",
    primaryMutedHover: "#c4dcf1",
    primaryForeground: "#ffffff",
    accent: "#245f9e",
    focusRing: "#5594cb",
    heroBackground: "#386fba",
    heroForeground: "#ffffff",
  }),
  createTheme({
    id: "orange-light",
    name: "Aprikos",
    background: "#faf1e8",
    surface: "#fffdf9",
    surfaceMuted: "#f4e5d7",
    surfaceHover: "#edd8c5",
    text: "#34251d",
    textMuted: "#755d4e",
    textSubtle: "#9b806f",
    border: "#e6d2c1",
    borderStrong: "#ccb49f",
    primary: "#a94720",
    primaryHover: "#8d3818",
    primaryMuted: "#f5dbc8",
    primaryMutedHover: "#efc9ad",
    primaryForeground: "#ffffff",
    accent: "#a94720",
    focusRing: "#d77d4d",
    heroBackground: "#c85c2e",
    heroForeground: "#ffffff",
  }),
  createTheme({
    id: "blue-dark",
    name: "Midnattsblå",
    background: "#101923",
    surface: "#172431",
    surfaceMuted: "#1d2d3c",
    surfaceHover: "#273b4d",
    text: "#f4f8fc",
    textMuted: "#afc0cf",
    textSubtle: "#7f96a9",
    border: "#2e4355",
    borderStrong: "#415a6e",
    primary: "#75b8f0",
    primaryHover: "#92c8f4",
    primaryMuted: "#203f5b",
    primaryMutedHover: "#295170",
    primaryForeground: "#102131",
    accent: "#8bc6f6",
    focusRing: "#68aee8",
    heroBackground: "#0a223a",
    heroForeground: "#ffffff",
  }),
  createTheme({
    id: "orange-dark",
    name: "Glöd",
    background: "#211713",
    surface: "#2d201a",
    surfaceMuted: "#392820",
    surfaceHover: "#493328",
    text: "#fff8f3",
    textMuted: "#d2b8a8",
    textSubtle: "#a88775",
    border: "#4d382e",
    borderStrong: "#664a3c",
    primary: "#f29a62",
    primaryHover: "#ffad76",
    primaryMuted: "#593520",
    primaryMutedHover: "#704329",
    primaryForeground: "#27150c",
    accent: "#ffb17d",
    focusRing: "#e98750",
    heroBackground: "#32170f",
    heroForeground: "#ffffff",
  }),
];

export const defaultCustomPalette = (): ThemePalette => ({
  ...builtInPalettes[0],
  id: crypto.randomUUID(),
  name: "Min palett",
});

/** Migrates legacy persisted custom palettes while returning the new contract. */
export function normalizePalette(
  palette: LegacyThemePalette & Pick<ThemePalette, "id" | "name">,
): ThemePalette {
  const fallback = builtInPalettes[0];
  const normalized = {
    ...fallback,
    ...palette,
    surfaceHover:
      palette.surfaceHover ?? palette.surfaceMuted ?? fallback.surfaceHover,
    textSubtle: palette.textSubtle ?? palette.textMuted ?? fallback.textSubtle,
    borderStrong:
      palette.borderStrong ?? palette.border ?? fallback.borderStrong,
    primaryMuted:
      palette.primaryMuted ?? palette.primarySoft ?? fallback.primaryMuted,
    primaryMutedHover:
      palette.primaryMutedHover ??
      palette.primarySoftHover ??
      palette.primaryMuted ??
      palette.primarySoft ??
      fallback.primaryMutedHover,
    primaryForeground:
      palette.primaryForeground ??
      palette.primaryText ??
      fallback.primaryForeground,
    accent:
      palette.accent ??
      palette.accentText ??
      palette.primary ??
      fallback.accent,
    focusRing:
      palette.focusRing ??
      palette.primaryMuted ??
      palette.primarySoft ??
      fallback.focusRing,
    heroBackground:
      palette.heroBackground ?? palette.hero ?? fallback.heroBackground,
    heroForeground:
      palette.heroForeground ?? palette.heroText ?? fallback.heroForeground,
  } as ThemePalette;
  return normalized;
}

export function resolvePalette(
  selectedId: string,
  customPalettes: ThemePalette[],
) {
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
  "background",
  "surface",
  "surfaceMuted",
  "surfaceHover",
  "text",
  "textMuted",
  "textSubtle",
  "border",
  "borderStrong",
  "primary",
  "primaryHover",
  "primaryMuted",
  "primaryMutedHover",
  "primaryForeground",
  "accent",
  "focusRing",
  "heroBackground",
  "heroForeground",
  "success",
  "successMuted",
  "successForeground",
  "warning",
  "warningMuted",
  "warningForeground",
  "danger",
  "dangerMuted",
  "dangerForeground",
  "info",
  "infoMuted",
  "infoForeground",
] as const satisfies readonly (keyof Omit<ThemePalette, "id" | "name">)[];

function relativeLuminance(color: string) {
  const hex = color.replace("#", "");
  if (!/^[\da-f]{6}$/i.test(hex)) return 0;
  const channels = [0, 2, 4].map(
    (index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255,
  );
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string) {
  const [lighter, darker] = [
    relativeLuminance(foreground),
    relativeLuminance(background),
  ].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

export function validateTheme(palette: ThemePalette): string[] {
  const errors = requiredThemeKeys
    .filter((key) => !palette[key])
    .map((key) => `${palette.name}: saknar ${key}`);
  const contrastPairs: [keyof ThemePalette, keyof ThemePalette][] = [
    ["primary", "primaryForeground"],
    ["success", "successForeground"],
    ["warning", "warningForeground"],
    ["danger", "dangerForeground"],
    ["info", "infoForeground"],
  ];
  contrastPairs.forEach(([background, foreground]) => {
    const ratio = contrastRatio(
      palette[background] as string,
      palette[foreground] as string,
    );
    if (ratio < 4.5)
      errors.push(
        `${palette.name}: ${String(foreground)} på ${String(background)} har kontrast ${ratio.toFixed(2)}:1 (kräver 4.5:1)`,
      );
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
    "--palette-hero-background": palette.heroBackground,
    "--palette-hero-foreground": palette.heroForeground,
    "--palette-success": palette.success,
    "--palette-success-muted": palette.successMuted,
    "--palette-success-foreground": palette.successForeground,
    "--palette-warning": palette.warning,
    "--palette-warning-muted": palette.warningMuted,
    "--palette-warning-foreground": palette.warningForeground,
    "--palette-danger": palette.danger,
    "--palette-danger-muted": palette.dangerMuted,
    "--palette-danger-foreground": palette.dangerForeground,
    "--palette-info": palette.info,
    "--palette-info-muted": palette.infoMuted,
    "--palette-info-foreground": palette.infoForeground,
    // shadcn/ui token bridge.
    "--background": palette.background,
    "--foreground": palette.text,
    "--card": palette.surface,
    "--card-foreground": palette.text,
    "--popover": palette.surface,
    "--popover-foreground": palette.text,
    "--primary": palette.primary,
    "--primary-foreground": palette.primaryForeground,
    "--secondary": palette.surfaceMuted,
    "--secondary-foreground": palette.text,
    "--muted": palette.surfaceMuted,
    "--muted-foreground": palette.textMuted,
    "--accent": palette.surfaceHover,
    "--accent-foreground": palette.text,
    "--destructive": palette.danger,
    "--destructive-foreground": palette.dangerForeground,
    "--border": palette.border,
    "--input": palette.borderStrong,
    "--ring": palette.focusRing,
    "--sidebar": palette.surface,
    "--sidebar-foreground": palette.text,
    "--sidebar-primary": palette.primary,
    "--sidebar-primary-foreground": palette.primaryForeground,
    "--sidebar-accent": palette.surfaceHover,
    "--sidebar-accent-foreground": palette.text,
    "--sidebar-border": palette.border,
    "--sidebar-ring": palette.focusRing,
  };
  Object.entries(values).forEach(([name, value]) =>
    root.style.setProperty(name, value),
  );
}
