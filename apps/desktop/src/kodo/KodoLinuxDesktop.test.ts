import { describe, expect, it } from "vite-plus/test";

import { chooseHeaderButtons, isGnomeSession } from "./KodoLinuxDesktop.ts";

const LAYOUT = { left: [], right: ["close"] } as const;
const GNOME = { XDG_CURRENT_DESKTOP: "ubuntu:GNOME" };

describe("isGnomeSession", () => {
  it.each([
    ["GNOME", true],
    ["ubuntu:GNOME", true],
    ["GNOME-Classic:GNOME", true],
    ["gnome", true],
    ["KDE", false],
    ["X-Cinnamon", false],
    ["GNOME-Flashback:Unity", false],
    ["", false],
  ])("%j is %s", (desktop, expected) => {
    expect(isGnomeSession({ XDG_CURRENT_DESKTOP: desktop })).toBe(expected);
  });

  it("is false without the variable", () => {
    expect(isGnomeSession({})).toBe(false);
  });
});

describe("chooseHeaderButtons", () => {
  const choose = (input: Partial<Parameters<typeof chooseHeaderButtons>[0]>) =>
    chooseHeaderButtons({
      platform: "linux",
      env: GNOME,
      useSystemTitleBar: false,
      layout: LAYOUT,
      ...input,
    });

  it("draws the buttons on GNOME with a readable layout", () => {
    expect(choose({})).toBe(LAYOUT);
  });

  it("keeps the system frame when the setting says so, the layout is unreadable or the desktop is not GNOME", () => {
    expect(choose({ useSystemTitleBar: true })).toBeNull();
    expect(choose({ layout: null })).toBeNull();
    expect(choose({ env: { XDG_CURRENT_DESKTOP: "KDE" } })).toBeNull();
    expect(choose({ env: {} })).toBeNull();
    expect(choose({ platform: "darwin" })).toBeNull();
    expect(choose({ platform: "win32" })).toBeNull();
  });
});
