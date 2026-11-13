import { describe, expect, it } from "@effect/vitest";

import { maximizeButtonLabel, windowControlsWidth, windowStateName } from "./windowChrome.logic";

describe("windowControlsWidth", () => {
  it("leaves nothing for a side without buttons and grows by a button and a gap", () => {
    expect(windowControlsWidth(0)).toBe(0);
    expect(windowControlsWidth(1)).toBe(36);
    expect(windowControlsWidth(3)).toBe(3 * 24 + 2 * 6 + 12);
  });
});

describe("window state", () => {
  it("names fullscreen before maximized, and offers restore in both", () => {
    expect(windowStateName({ maximized: true, fullscreen: true })).toBe("fullscreen");
    expect(windowStateName({ maximized: true, fullscreen: false })).toBe("maximized");
    expect(windowStateName({ maximized: false, fullscreen: false })).toBe("normal");
    expect(maximizeButtonLabel({ maximized: false, fullscreen: true })).toBe("Restore");
    expect(maximizeButtonLabel({ maximized: false, fullscreen: false })).toBe("Maximize");
  });
});
