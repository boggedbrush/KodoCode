import { describe, expect, it } from "@effect/vitest";

import { kodoLoopStageMarkerLabel, parseKodoLoopStageMessageId } from "./loopStageMarker.logic";

describe("a loop stage message's id", () => {
  it.each([
    ["kodo-loop-command-1f3a-r1-plan", { round: 1, stage: "plan", attempt: 0 }],
    ["kodo-loop-abc-def-r12-judge", { round: 12, stage: "judge", attempt: 0 }],
    ["kodo-loop-x-r2-judge-a1", { round: 2, stage: "judge", attempt: 1 }],
  ])("%s names its stage", (id, expected) => {
    expect(parseKodoLoopStageMessageId(id)).toEqual(expected);
  });

  it.each(["message-1", "kodo-loop-x-r1-fix", "kodo-loop-r1-plan", "my-kodo-loop-x-r1-plan"])(
    "%s is an ordinary message",
    (id) => {
      expect(parseKodoLoopStageMessageId(id)).toBeNull();
    },
  );

  it("reads as a one-line marker, with a retry noted", () => {
    expect(kodoLoopStageMarkerLabel({ round: 1, stage: "judge", attempt: 0 })).toBe(
      "Round 1 · Judge",
    );
    expect(kodoLoopStageMarkerLabel({ round: 2, stage: "judge", attempt: 1 })).toBe(
      "Round 2 · Judge (try 2)",
    );
  });
});
