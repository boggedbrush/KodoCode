import { KODO_GNOME_ACCENT_COLORS, type KodoGnomeAccent } from "@t3tools/contracts";
import { KODO_THEME_ID } from "@t3tools/shared/kodoTheme";

/**
 * The system accent applies only to the built-in Kodo theme, and only while the person follows it.
 * Any other theme, a custom palette or a turned-off setting is an explicit choice, which wins.
 */
export function resolveSystemAccent(input: {
  readonly themeId: string | undefined;
  readonly follow: boolean;
  readonly systemAccent: KodoGnomeAccent | null;
}): KodoGnomeAccent | null {
  return input.themeId === KODO_THEME_ID && input.follow ? input.systemAccent : null;
}

const WHITE = "#ffffff";
const BLACK = "#000000";
/** WCAG AA for body text, which button labels are. */
const MIN_CONTRAST = 4.5;
// How far a hover state moves from the fill, as Kodo's own palette does: lighter in light mode,
// darker in dark mode, where lightening a fill is what takes white text below contrast.
const HOVER_STEPS = [0.12, 0.08, 0.06, 0.04, 0.03, 0.02, 0.01] as const;

const channels = (hex: string) =>
  [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));

function luminance(hex: string): number {
  const [red, green, blue] = channels(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (lighter + 0.05) / (darker + 0.05);
}

/** `color-mix(in srgb, towards <amount>, fill)`. */
function mixToward(fill: string, towards: string, amount: number): string {
  const target = channels(towards);
  return `#${channels(fill)
    .map((value, index) =>
      Math.round(value + ((target[index] ?? 0) - value) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function hoverState(fill: string, text: string, towards: string): string {
  for (const step of HOVER_STEPS) {
    const hover = mixToward(fill, towards, step);
    if (contrastRatio(text, hover) >= MIN_CONTRAST) return hover;
  }
  return fill;
}

/**
 * The colours the stylesheet derives the accent roles from (see kodo-gnome.css): GNOME's fill, the
 * text on it and on its hover state. The text is white or black, whichever reads better on the
 * fill, so every label meets 4.5:1 in both modes; the hover moves as far as that allows.
 */
export function accentColors(accent: KodoGnomeAccent): {
  readonly fill: string;
  readonly text: string;
  readonly hoverLight: string;
  readonly hoverDark: string;
} {
  const fill = KODO_GNOME_ACCENT_COLORS[accent];
  const text = contrastRatio(fill, WHITE) >= contrastRatio(fill, BLACK) ? WHITE : BLACK;
  return {
    fill,
    text,
    hoverLight: hoverState(fill, text, WHITE),
    hoverDark: hoverState(fill, text, BLACK),
  };
}
