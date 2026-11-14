import { KODO_QUIET_MAX_MINUTES } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { kodoQuietMinutesToSave } from "./quietMinutes.logic";

describe("the minutes saved from the quiet-worker field", () => {
  it.each([
    ["", 5, undefined],
    ["  ", 5, undefined],
    ["0", 5, 0],
    ["12", 5, 12],
    ["5", 5, undefined],
    ["2.5", 5, undefined],
    ["-1", 5, undefined],
    [String(KODO_QUIET_MAX_MINUTES + 1), 5, undefined],
    [String(KODO_QUIET_MAX_MINUTES), 5, KODO_QUIET_MAX_MINUTES],
  ])("%j with %i set saves %s", (raw, current, expected) => {
    expect(kodoQuietMinutesToSave(raw, current)).toBe(expected);
  });
});
