import { describe, expect, it } from "@effect/vitest";

import { isKodoLoopQuery } from "./loopCommand.logic";

describe("isKodoLoopQuery", () => {
  it.each(["/loop stop", "  /LOOP   Stop  ", "/loop status", "/loop STATUS\n"])(
    "%j is answered without a message",
    (text) => {
      expect(isKodoLoopQuery(text)).toBe(true);
    },
  );

  it.each([
    "/loop stop the parser changes",
    "/loop add retries",
    "/loop 3 stop",
    "/loops stop",
    "/loop",
    "stop",
    "please /loop stop",
  ])("%j is an ordinary message or a loop to start", (text) => {
    expect(isKodoLoopQuery(text)).toBe(false);
  });
});
