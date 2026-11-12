import { describe, expect, it } from "vite-plus/test";

import {
  MODE_ACCENT_CSS_VARIABLES,
  MODE_ACCENT_IDS,
  modeAccentColor,
  modeAccentColorMix,
} from "./modeAccents";

describe("modeAccents", () => {
  it("names one CSS variable per mode", () => {
    expect(MODE_ACCENT_IDS.map((mode) => MODE_ACCENT_CSS_VARIABLES[mode])).toEqual([
      "--mode-ask",
      "--mode-plan",
      "--mode-code",
      "--mode-review",
    ]);
  });

  it("references the variable instead of a literal colour", () => {
    expect(modeAccentColor("code")).toBe("var(--mode-code)");
    expect(modeAccentColorMix("plan", 18)).toBe(
      "color-mix(in srgb, var(--mode-plan) 18%, transparent)",
    );
  });
});
