import { KODO_GNOME_ACCENT_COLORS, type KodoGnomeAccent } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { accentColors, resolveSystemAccent } from "./systemAccent.logic";

describe("resolveSystemAccent", () => {
  it("follows the system only on the Kodo theme", () => {
    expect(resolveSystemAccent({ themeId: "kodo", follow: true, systemAccent: "teal" })).toBe(
      "teal",
    );
  });

  it("lets an explicit choice win: another theme, a preview, no theme or the setting off", () => {
    for (const themeId of ["t3-chat", "__preview", "custom-1", undefined]) {
      expect(resolveSystemAccent({ themeId, follow: true, systemAccent: "teal" })).toBeNull();
    }
    expect(
      resolveSystemAccent({ themeId: "kodo", follow: false, systemAccent: "teal" }),
    ).toBeNull();
  });

  it("keeps Kodo's own accent when the desktop reports none", () => {
    expect(resolveSystemAccent({ themeId: "kodo", follow: true, systemAccent: null })).toBeNull();
  });
});

// WCAG relative luminance, written out here so the table checks the logic against the definition.
function luminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
const contrast = (first: string, second: string) =>
  (Math.max(luminance(first), luminance(second)) + 0.05) /
  (Math.min(luminance(first), luminance(second)) + 0.05);

describe("accentColors", () => {
  const accents = Object.keys(KODO_GNOME_ACCENT_COLORS) as KodoGnomeAccent[];

  it.each(accents)("%s: text on the fill and on both hover states meets 4.5:1", (accent) => {
    const { fill, text, hoverLight, hoverDark } = accentColors(accent);
    expect(fill).toBe(KODO_GNOME_ACCENT_COLORS[accent]);
    for (const background of [fill, hoverLight, hoverDark]) {
      expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(accents)(
    "%s: hover is lighter in light mode and never lighter in dark mode",
    (accent) => {
      const { fill, hoverLight, hoverDark } = accentColors(accent);
      expect(luminance(hoverLight)).toBeGreaterThanOrEqual(luminance(fill));
      expect(luminance(hoverDark)).toBeLessThanOrEqual(luminance(fill));
    },
  );

  it("picks white or black text, whichever reads better", () => {
    expect(accentColors("purple").text).toBe("#ffffff");
    expect(accentColors("yellow").text).toBe("#000000");
    expect(accentColors("blue").text).toBe("#000000");
  });
});
