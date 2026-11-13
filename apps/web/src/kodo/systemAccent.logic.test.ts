import { describe, expect, it } from "@effect/vitest";

import { accentFill, resolveSystemAccent } from "./systemAccent.logic";

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

describe("accentFill", () => {
  it("fills with GNOME's colour and reads dark text only on yellow", () => {
    expect(accentFill("blue")).toEqual({ fill: "#3584e4", text: "#ffffff" });
    expect(accentFill("yellow")).toEqual({ fill: "#c88800", text: "#241f31" });
  });
});
