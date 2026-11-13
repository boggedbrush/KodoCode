import { KODO_GNOME_ACCENT_COLORS, type KodoGnomeAccent } from "@t3tools/contracts";
import { KODO_THEME_ID } from "@t3tools/shared/kodoTheme";

/** Text on an accent fill: white, except on yellow, which white cannot be read on. */
const DARK_TEXT_ACCENTS: ReadonlySet<KodoGnomeAccent> = new Set(["yellow"]);

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

/** The two values the stylesheet derives the accent roles from (see kodo-gnome.css). */
export function accentFill(accent: KodoGnomeAccent): {
  readonly fill: string;
  readonly text: string;
} {
  return {
    fill: KODO_GNOME_ACCENT_COLORS[accent],
    text: DARK_TEXT_ACCENTS.has(accent) ? "#241f31" : "#ffffff",
  };
}
