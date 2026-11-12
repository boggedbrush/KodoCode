import {
  T3_CODE_DARK_THEME_COLORS,
  T3_CODE_LIGHT_THEME_COLORS,
  type ThemeColors,
  type ThemeDefinition,
} from "./themePalettes.js";

/**
 * The Kodo Code theme as a libadwaita 1.6 (GNOME 47/48) palette, added through
 * `WEB_BUILT_IN_THEMES` because mobile generates artifacts from `BUILT_IN_THEMES`.
 * Radii, fonts and shadows live in apps/web/src/kodo-gnome.css, keyed on this theme id.
 */
export const KODO_THEME_ID = "kodo" as const;

/** libadwaita expresses an accent as a fill, the text on that fill, and a text-on-window variant. */
type AdwaitaAccent = Readonly<{
  /** `accent_bg_color`: switches, suggested buttons, selections. */
  bg: string;
  /** `accent_fg_color`: text on `bg`. */
  fg: string;
  /** `accent_color`: links, focus ring, accent text on the window. Contrast-lifted in dark. */
  text: string;
  /** Accent mixed over the window colour at about 12% (light) or 18% (dark). */
  tint: string;
  /** `bg` nudged towards white, the hover state of an accent fill. */
  hover: string;
  /** `bg` at about 20% over the view colour, for selections. */
  selection: string;
}>;

const KODO_ACCENTS = {
  /** Kodo purple. GNOME's own purple option is #9141ac; Kodo keeps its indigo-violet. */
  kodo: {
    light: {
      bg: "#5236cc",
      fg: "#ffffff",
      text: "#4429b0",
      tint: "#eae7f9",
      hover: "#6046d0",
      selection: "#dcd7f5",
    },
    dark: {
      bg: "#7257e8",
      fg: "#ffffff",
      text: "#b9aaff",
      tint: "#302c49",
      /* Darker than bg: white text on a lightened #7257e8 would fall below 4.5:1. */
      hover: "#6a4fe0",
      selection: "#3a3066",
    },
  },
  /** Stock Adwaita blue, for reference and as the one-line fallback. */
  blue: {
    light: {
      bg: "#3584e4",
      fg: "#ffffff",
      text: "#1c71d8",
      tint: "#e7f0fc",
      hover: "#4a91e7",
      selection: "#cfe1f8",
    },
    dark: {
      bg: "#3584e4",
      fg: "#ffffff",
      text: "#78aeed",
      tint: "#253448",
      hover: "#4a91e7",
      selection: "#2a456b",
    },
  },
} as const satisfies Record<string, Readonly<Record<"light" | "dark", AdwaitaAccent>>>;

/** The accent token. Change this one line to `"blue"` for stock Adwaita blue (and mirror it in apps/web/index.html, which themeBoot.test.ts checks). */
const KODO_ACCENT_NAME: keyof typeof KODO_ACCENTS = "kodo";

const accentLight = KODO_ACCENTS[KODO_ACCENT_NAME].light;
const accentDark = KODO_ACCENTS[KODO_ACCENT_NAME].dark;

const KODO_LIGHT_THEME_COLORS: ThemeColors = {
  ...T3_CODE_LIGHT_THEME_COLORS,
  // window_bg_color, headerbar_bg_color
  canvas: "#fafafb",
  chrome: "#ffffff",
  toolbar: "#ffffff",
  toolbarForeground: "#333333",
  toolbarBorder: "#e0e0e2",
  toolbarControl: "#ffffff",
  toolbarControlForeground: "#333333",
  toolbarControlHover: "#ebebed",
  // card_bg_color, popover_bg_color
  surface: "#ffffff",
  surfaceRaised: "#ffffff",
  surfaceOverlay: "#ffffff",
  text: "#333333",
  textMuted: "#66666a",
  border: "#e2e2e4",
  input: "#d6d6d9",
  focus: accentLight.text,
  accent: accentLight.bg,
  accentForeground: accentLight.fg,
  secondary: "#ebebed",
  secondaryForeground: "#333333",
  muted: "#f1f1f3",
  mutedForeground: "#66666a",
  placeholder: "#66666a",
  secondaryLabel: "#66666a",
  iconMuted: "#5c5c60",
  // destructive_bg #e01b24, destructive_color #c01c28, warning #e5a50a
  error: "#e01b24",
  errorForeground: "#c01c28",
  errorSurface: "#fce8e9",
  warning: "#e5a50a",
  warningForeground: "#8a5d00",
  warningSurface: "#fcf4e2",
  update: accentLight.bg,
  updateForeground: accentLight.text,
  updateSurface: accentLight.tint,
  accentSurface: "#ededef",
  accentSurfaceForeground: "#333333",
  messageSurface: "#ebebed",
  messageForeground: "#333333",
  messageAction: accentLight.bg,
  messageActionForeground: accentLight.fg,
  messageActionHover: accentLight.hover,
  codeBackground: "#f3f3f5",
  codeForeground: "#333333",
  // sidebar_bg_color
  sidebar: "#ebebed",
  sidebarForeground: "#333333",
  sidebarMutedForeground: "#5f5f63",
  sidebarControlSurface: "#e0e0e3",
  sidebarRowHover: "#dfdfe2",
  sidebarRowActive: "#d6d6da",
  sidebarRowSelected: "#d6d6da",
  sidebarBorder: "#dadadd",
  terminalBackground: "#ffffff",
  terminalForeground: "#333333",
  terminalCursor: accentLight.bg,
  terminalSelection: accentLight.selection,
  terminalScrollbar: "#c9c9cc",
  terminalScrollbarHover: "#aaaaae",
};

const KODO_DARK_THEME_COLORS: ThemeColors = {
  ...T3_CODE_DARK_THEME_COLORS,
  // window_bg_color #222226, headerbar_bg_color #2e2e32
  canvas: "#222226",
  chrome: "#2e2e32",
  toolbar: "#2e2e32",
  toolbarForeground: "#ffffff",
  toolbarBorder: "#1d1d20",
  toolbarControl: "#2e2e32",
  toolbarControlForeground: "#ffffff",
  toolbarControlHover: "#3b3b3f",
  // card_bg_color (white at 8% over the window), popover_bg_color #36363a
  surface: "#343437",
  surfaceRaised: "#343437",
  surfaceOverlay: "#36363a",
  text: "#ffffff",
  textMuted: "#a8a8ab",
  border: "#3c3c40",
  input: "#47474b",
  focus: accentDark.text,
  accent: accentDark.bg,
  accentForeground: accentDark.fg,
  secondary: "#3a3a3e",
  secondaryForeground: "#ffffff",
  muted: "#2b2b2f",
  mutedForeground: "#a8a8ab",
  placeholder: "#a8a8ab",
  secondaryLabel: "#a8a8ab",
  iconMuted: "#b4b4b7",
  error: "#d92a35",
  errorForeground: "#ff7b63",
  errorSurface: "#3b2126",
  warning: "#cd9309",
  warningForeground: "#f8e45c",
  warningSurface: "#3d3421",
  update: accentDark.bg,
  updateForeground: accentDark.text,
  updateSurface: accentDark.tint,
  accentSurface: "#3a3a3e",
  accentSurfaceForeground: "#ffffff",
  messageSurface: "#3a3a3e",
  messageForeground: "#ffffff",
  messageAction: accentDark.bg,
  messageActionForeground: accentDark.fg,
  messageActionHover: accentDark.hover,
  codeBackground: "#1d1d20",
  codeForeground: "#ffffff",
  // sidebar_bg_color #2e2e32
  sidebar: "#2e2e32",
  sidebarForeground: "#ffffff",
  sidebarMutedForeground: "#a8a8ab",
  sidebarControlSurface: "#3a3a3e",
  sidebarRowHover: "#38383c",
  sidebarRowActive: "#434346",
  sidebarRowSelected: "#434346",
  sidebarBorder: "#1d1d20",
  terminalBackground: "#1d1d20",
  terminalForeground: "#f2f2f2",
  terminalCursor: accentDark.text,
  terminalSelection: accentDark.selection,
  terminalScrollbar: "#47474b",
  terminalScrollbarHover: "#5e5e63",
};

export const KODO_THEME: ThemeDefinition = {
  id: KODO_THEME_ID,
  label: "Kodo Code",
  appearance: "light",
  colors: KODO_LIGHT_THEME_COLORS,
  variants: { dark: KODO_DARK_THEME_COLORS },
};
