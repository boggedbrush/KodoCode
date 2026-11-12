import { describe, expect, it } from "@effect/vitest";
import { KODO_LOOP_MAX_ROUNDS, KODO_LOOP_REQUEST_MAX_CHARS, MessageId } from "@t3tools/contracts";

import {
  applyKodoLoopOp,
  nextKodoLoopStage,
  type KodoLoopOp,
  type KodoLoopServerOp,
  type KodoLoopStartOp,
} from "./loopState.ts";
import { incompleteVerdict, testLoop, testRecord } from "./testing.ts";

const start: KodoLoopStartOp = {
  type: "start",
  loopId: "L2",
  request: "  Add retries.  ",
  requestMessageId: MessageId.make("m-2"),
  startMode: "ask",
  maxRounds: 3,
  planApproval: "ask",
  budget: { stopAtLimitPercent: 90 },
};

const server = (loop = testLoop()) => ({ loopId: loop.loopId, expectedRevision: loop.revision });

const refusal = (loop: ReturnType<typeof testLoop> | undefined, op: KodoLoopOp) => {
  const result = applyKodoLoopOp(loop, op);
  return result.ok ? "ok" : result.reason;
};

describe("start", () => {
  it("creates an active loop at the plan of round one", () => {
    const result = applyKodoLoopOp(undefined, start);
    expect(result).toEqual({
      ok: true,
      loop: {
        loopId: "L2",
        revision: 1,
        status: "active",
        round: 1,
        maxRounds: 3,
        stage: "plan",
        request: "Add retries.",
        requestMessageId: "m-2",
        startMode: "ask",
        planApproval: "ask",
        budget: { stopAtLimitPercent: 90 },
        baseline: {},
        stages: [],
      },
    });
  });

  it("replaces an ended loop but not one that is running or waiting", () => {
    for (const status of ["done", "stopped", "failed"] as const) {
      expect(refusal(testLoop({ status }), start)).toBe("ok");
    }
    expect(refusal(testLoop({ status: "active" }), start)).toBe("loop_exists");
    expect(refusal(testLoop({ status: "held", hold: "plan_approval" }), start)).toBe("loop_exists");
  });

  it.each([
    ["an empty request", { request: "   " }],
    ["a request over the cap", { request: "x".repeat(KODO_LOOP_REQUEST_MAX_CHARS + 1) }],
    ["zero rounds", { maxRounds: 0 }],
    ["too many rounds", { maxRounds: KODO_LOOP_MAX_ROUNDS + 1 }],
    ["a fractional round count", { maxRounds: 2.5 }],
  ])("refuses %s", (_name, over) => {
    expect(refusal(undefined, { ...start, ...over })).toBe("invalid");
  });
});

describe("stale writers", () => {
  const ops: ReadonlyArray<[string, KodoLoopServerOp]> = [
    ["hold", { ...server(), type: "hold", hold: "runtime_request" }],
    ["release", { ...server(), type: "release" }],
    ["advance", { ...server(), type: "advance", record: testRecord({ round: 1, stage: "plan" }) }],
    ["finish", { ...server(), type: "finish", status: "stopped", reason: "budget" }],
  ];

  it.each(ops)("a %s from an older revision is refused and changes nothing", (_name, op) => {
    const current = testLoop({ revision: 2 });
    const result = applyKodoLoopOp(current, op);
    expect(result).toMatchObject({ ok: false, reason: "stale_revision" });
    expect(current.revision).toBe(2);
    expect(current.status).toBe("active");
  });

  it("a user stop that landed first wins over the tick that observed the loop before it", () => {
    const observed = testLoop({ revision: 4 });
    const stopped = applyKodoLoopOp(observed, { type: "stop" });
    expect(stopped.ok && stopped.loop.revision).toBe(5);
    const late = applyKodoLoopOp(stopped.ok ? stopped.loop : undefined, {
      ...server(observed),
      type: "advance",
      record: testRecord({ round: 1, stage: "plan" }),
    });
    expect(late).toMatchObject({ ok: false, reason: "stale_revision" });
  });

  it("a writer for a replaced loop is refused even at a matching revision", () => {
    const loop = testLoop({ loopId: "L2", revision: 1 });
    expect(refusal(loop, { loopId: "L1", expectedRevision: 1, type: "release" })).toBe(
      "wrong_loop",
    );
  });

  it("a writer finds no loop, or one that has ended, to write to", () => {
    expect(refusal(undefined, { ...server(), type: "release" })).toBe("no_loop");
    const ended = testLoop({ status: "stopped", stopReason: "user_stop" });
    expect(refusal(ended, { ...server(ended), type: "hold", hold: "runtime_request" })).toBe(
      "not_active",
    );
  });
});

describe("client operations apply whatever the revision", () => {
  it("stop ends an active or held loop with user_stop and clears the hold", () => {
    for (const loop of [
      testLoop(),
      testLoop({ status: "held", hold: "plan_approval", stage: "code" }),
    ]) {
      const result = applyKodoLoopOp(loop, { type: "stop" });
      expect(result).toMatchObject({
        ok: true,
        loop: { status: "stopped", stopReason: "user_stop", revision: loop.revision + 1 },
      });
      expect(result.ok && result.loop).not.toHaveProperty("hold");
    }
  });

  it("stop on an ended loop, or none, says so", () => {
    expect(refusal(testLoop({ status: "done", stopReason: "complete" }), { type: "stop" })).toBe(
      "not_active",
    );
    expect(refusal(undefined, { type: "stop" })).toBe("no_loop");
  });

  it("approve resumes only a loop waiting for a plan approval", () => {
    const held = testLoop({ status: "held", hold: "plan_approval", stage: "code" });
    const result = applyKodoLoopOp(held, { type: "approve" });
    expect(result).toMatchObject({ ok: true, loop: { status: "active", stage: "code" } });
    expect(result.ok && result.loop).not.toHaveProperty("hold");
    expect(refusal(testLoop(), { type: "approve" })).toBe("not_held");
    expect(
      refusal(testLoop({ status: "held", hold: "runtime_request" }), { type: "approve" }),
    ).toBe("not_held");
  });

  it("extend adds rounds to a loop that hit the cap and starts the next round at plan", () => {
    const capped = testLoop({
      status: "stopped",
      stopReason: "round_cap",
      stopDetail: "x",
      round: 3,
      maxRounds: 3,
      stage: "judge",
    });
    const result = applyKodoLoopOp(capped, { type: "extend", rounds: 2 });
    expect(result).toMatchObject({
      ok: true,
      loop: { status: "active", maxRounds: 5, round: 4, stage: "plan" },
    });
    expect(result.ok && result.loop).not.toHaveProperty("stopReason");
    expect(result.ok && result.loop).not.toHaveProperty("stopDetail");
  });

  it.each([
    ["a loop that is running", testLoop(), 1, "not_resumable"],
    [
      "a loop that stopped for another reason",
      testLoop({ status: "stopped", stopReason: "budget" }),
      1,
      "not_resumable",
    ],
    [
      "more rounds than a loop may have",
      testLoop({ status: "stopped", stopReason: "round_cap", maxRounds: 15 }),
      2,
      "invalid",
    ],
    ["no rounds", testLoop({ status: "stopped", stopReason: "round_cap" }), 0, "invalid"],
  ] as const)("extend refuses %s", (_name, loop, rounds, reason) => {
    expect(refusal(loop, { type: "extend", rounds })).toBe(reason);
  });

  it("retry-judge reopens only a loop whose judge answer was unreadable", () => {
    const failed = testLoop({ status: "failed", stopReason: "verdict_invalid", stage: "judge" });
    expect(applyKodoLoopOp(failed, { type: "retry-judge" })).toMatchObject({
      ok: true,
      loop: { status: "active", stage: "judge" },
    });
    expect(
      refusal(testLoop({ status: "failed", stopReason: "error", stage: "judge" }), {
        type: "retry-judge",
      }),
    ).toBe("not_resumable");
    expect(
      refusal(testLoop({ status: "failed", stopReason: "verdict_invalid", stage: "code" }), {
        type: "retry-judge",
      }),
    ).toBe("not_resumable");
  });
});

describe("server operations", () => {
  it("hold and release move between active and held(runtime_request)", () => {
    const loop = testLoop({ stage: "code" });
    const held = applyKodoLoopOp(loop, { ...server(loop), type: "hold", hold: "runtime_request" });
    expect(held).toMatchObject({
      ok: true,
      loop: { status: "held", hold: "runtime_request", revision: 2 },
    });
    if (!held.ok) return;
    expect(
      refusal(held.loop, { ...server(held.loop), type: "hold", hold: "runtime_request" }),
    ).toBe("not_active");
    const released = applyKodoLoopOp(held.loop, { ...server(held.loop), type: "release" });
    expect(released).toMatchObject({ ok: true, loop: { status: "active", revision: 3 } });
    expect(released.ok && released.loop).not.toHaveProperty("hold");
  });

  it.each([
    ["plan", { round: 1, stage: "code" }],
    ["code", { round: 1, stage: "review" }],
    ["review", { round: 1, stage: "judge" }],
    ["judge", { round: 2, stage: "plan" }],
  ] as const)("advancing a settled %s moves to %j and keeps its record", (stage, next) => {
    const loop = testLoop({ stage });
    const record = testRecord({ round: 1, stage });
    const result = applyKodoLoopOp(loop, { ...server(loop), type: "advance", record });
    expect(result).toMatchObject({ ok: true, loop: { ...next, status: "active", revision: 2 } });
    expect(result.ok && result.loop.stages).toEqual([record]);
  });

  it("advancing after a plan can wait for approval, which only a plan can ask for", () => {
    const loop = testLoop({ planApproval: "ask" });
    const record = testRecord({ round: 1, stage: "plan" });
    expect(
      applyKodoLoopOp(loop, { ...server(loop), type: "advance", record, hold: "plan_approval" }),
    ).toMatchObject({
      ok: true,
      loop: { status: "held", hold: "plan_approval", stage: "code" },
    });
    const code = testLoop({ stage: "code" });
    expect(
      refusal(code, {
        ...server(code),
        type: "advance",
        record: testRecord({ round: 1, stage: "code" }),
        hold: "plan_approval",
      }),
    ).toBe("invalid");
  });

  it("a held loop waiting for a person does not advance, one waiting on a request does", () => {
    const waiting = testLoop({ stage: "code", status: "held", hold: "runtime_request" });
    const record = testRecord({ round: 1, stage: "code" });
    expect(applyKodoLoopOp(waiting, { ...server(waiting), type: "advance", record })).toMatchObject(
      {
        ok: true,
        loop: { status: "active", stage: "review" },
      },
    );
    const approving = testLoop({ stage: "plan", status: "held", hold: "plan_approval" });
    expect(
      refusal(approving, {
        ...server(approving),
        type: "advance",
        record: testRecord({ round: 1, stage: "plan" }),
      }),
    ).toBe("not_active");
  });

  it("refuses a record that is not the loop's current stage, and a round past the cap", () => {
    const loop = testLoop({ stage: "code" });
    expect(
      refusal(loop, {
        ...server(loop),
        type: "advance",
        record: testRecord({ round: 1, stage: "review" }),
      }),
    ).toBe("invalid");
    expect(
      refusal(loop, {
        ...server(loop),
        type: "advance",
        record: testRecord({ round: 2, stage: "code" }),
      }),
    ).toBe("invalid");
    const last = testLoop({ round: 3, maxRounds: 3, stage: "judge" });
    expect(
      refusal(last, {
        ...server(last),
        type: "advance",
        record: testRecord({ round: 3, stage: "judge" }),
      }),
    ).toBe("invalid");
  });

  it("a record replaces an earlier one for the same stage message and appends otherwise", () => {
    const earlier = testRecord({ round: 1, stage: "plan", status: "failed" });
    const loop = testLoop({ stage: "plan", stages: [earlier] });
    const again = testRecord({ round: 1, stage: "plan" });
    const replaced = applyKodoLoopOp(loop, { ...server(loop), type: "advance", record: again });
    expect(replaced.ok && replaced.loop.stages).toEqual([again]);
    const retried = testRecord({
      round: 1,
      stage: "plan",
      messageId: MessageId.make("kodo-loop-L1-r1-plan-a1"),
    });
    const appended = applyKodoLoopOp(loop, { ...server(loop), type: "advance", record: retried });
    expect(appended.ok && appended.loop.stages).toEqual([earlier, retried]);
  });

  it("keeps the newest records when the list is full", () => {
    const stages = Array.from({ length: KODO_LOOP_MAX_ROUNDS * 4 }, (_, index) =>
      testRecord({ round: 1, stage: "plan", messageId: MessageId.make(`old-${index}`) }),
    );
    const loop = testLoop({ stages });
    const record = testRecord({ round: 1, stage: "plan" });
    const result = applyKodoLoopOp(loop, { ...server(loop), type: "advance", record });
    expect(result.ok && result.loop.stages).toHaveLength(KODO_LOOP_MAX_ROUNDS * 4);
    expect(result.ok && result.loop.stages.at(-1)).toEqual(record);
    expect(result.ok && result.loop.stages[0]?.messageId).toBe("old-1");
  });

  it.each([
    ["done", "complete"],
    ["stopped", "round_cap"],
    ["stopped", "budget"],
    ["stopped", "user_message"],
    ["stopped", "provider_limit"],
    ["failed", "error"],
    ["failed", "verdict_invalid"],
  ] as const)("finishes as %s for %s with its record, detail and summary", (status, reason) => {
    const loop = testLoop({ stage: "judge", status: "held", hold: "runtime_request" });
    const record = testRecord({ round: 1, stage: "judge", verdict: incompleteVerdict });
    const result = applyKodoLoopOp(loop, {
      ...server(loop),
      type: "finish",
      status,
      reason,
      detail: "why",
      record,
      summary: "Summary.",
    });
    expect(result).toMatchObject({
      ok: true,
      loop: { status, stopReason: reason, stopDetail: "why", summary: "Summary.", stage: "judge" },
    });
    expect(result.ok && result.loop).not.toHaveProperty("hold");
    expect(result.ok && result.loop.stages).toEqual([record]);
  });

  it.each([
    ["done", "budget"],
    ["stopped", "complete"],
    ["stopped", "user_stop"],
    ["failed", "round_cap"],
  ] as const)("refuses to finish as %s for %s", (status, reason) => {
    const loop = testLoop();
    expect(refusal(loop, { ...server(loop), type: "finish", status, reason })).toBe("invalid");
  });
});

describe("stage order", () => {
  it("steps through a round and into the next, and ends after the last judge", () => {
    expect(nextKodoLoopStage({ round: 2, stage: "judge" }, 3)).toEqual({ round: 3, stage: "plan" });
    expect(nextKodoLoopStage({ round: 3, stage: "judge" }, 3)).toBeNull();
  });
});
