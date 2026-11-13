import { describe, expect, it } from "vite-plus/test";

import { gnomeAccentFromPortalColor, parseGnomeAccent } from "./gnomeAccent.ts";

describe("parseGnomeAccent", () => {
  it.each([
    ["'purple'\n", "purple"],
    ['"slate"', "slate"],
    ["'blue'", "blue"],
  ])("reads %j", (output, expected) => {
    expect(parseGnomeAccent(output)).toBe(expected);
  });

  it.each(["", "'magenta'", "purple", "'purple", "@s 'blue'", "No such key"])(
    "cannot read %j",
    (output) => {
      expect(parseGnomeAccent(output)).toBeNull();
    },
  );
});

describe("gnomeAccentFromPortalColor", () => {
  it("names the accent whose fill the portal sent", () => {
    // #3584e4 and #9141ac as the portal sends them.
    expect(gnomeAccentFromPortalColor([0x35 / 255, 0x84 / 255, 0xe4 / 255])).toBe("blue");
    expect(gnomeAccentFromPortalColor([0x91 / 255, 0x41 / 255, 0xac / 255])).toBe("purple");
  });

  it("tolerates rounding in the sent colour", () => {
    expect(gnomeAccentFromPortalColor([0.93, 0.36, 0.01])).toBe("orange");
  });

  it.each([
    [[-1, -1, -1]],
    [[2, 0, 0]],
    [[0, 0]],
    ["blue"],
    [null],
    [[0, 0, "1"]],
    // Black is no accent.
    [[0, 0, 0]],
  ])("reports no accent for %j", (value) => {
    expect(gnomeAccentFromPortalColor(value)).toBeNull();
  });
});
