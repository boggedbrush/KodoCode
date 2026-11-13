import { KODO_GNOME_ACCENT_COLORS, type KodoGnomeAccent } from "@t3tools/contracts";

/** Reads `org.gnome.desktop.interface accent-color`, as `gsettings get` prints it: `'purple'`. */
export function parseGnomeAccent(output: string): KodoGnomeAccent | null {
  const match = /^(['"])([a-z]+)\1$/.exec(output.trim());
  const accent = match?.[2];
  if (accent === undefined) return null;
  return Object.hasOwn(KODO_GNOME_ACCENT_COLORS, accent) ? (accent as KodoGnomeAccent) : null;
}

const channels = (hex: string) =>
  [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255) as [
    number,
    number,
    number,
  ];

// The portal's accent is the colour of the accent's fill, so the nearest fill names it.
// A sRGB difference beyond this is a colour no GNOME accent produces.
const MAX_DISTANCE = 0.12;

/**
 * Names the accent a freedesktop portal `accent-color` value is. The portal sends three doubles
 * in 0..1, and a value outside that range when the desktop sets no accent.
 */
export function gnomeAccentFromPortalColor(value: unknown): KodoGnomeAccent | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const rgb = value as unknown[];
  if (!rgb.every((channel) => typeof channel === "number" && channel >= 0 && channel <= 1)) {
    return null;
  }
  let best: { accent: KodoGnomeAccent; distance: number } | null = null;
  for (const [accent, hex] of Object.entries(KODO_GNOME_ACCENT_COLORS) as [
    KodoGnomeAccent,
    string,
  ][]) {
    const distance = Math.hypot(
      ...channels(hex).map((channel, index) => channel - (rgb[index] as number)),
    );
    if (best === null || distance < best.distance) best = { accent, distance };
  }
  return best !== null && best.distance <= MAX_DISTANCE ? best.accent : null;
}
