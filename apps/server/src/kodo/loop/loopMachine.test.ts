import { describe, expect, it } from "@effect/vitest";
import type { KodoLoop } from "@t3tools/contracts";

import {
  decideLoopStep,
  kodoLoopStageMessageId,
  type LoopObservation,
  type LoopRunView,
} from "./loopMachine.ts";
import {
  completeVerdict,
  incompleteVerdict,
  passReview,
  reviewBlock,
  testLoop,
  testRecord,
  verdictBlock,
} from "./testing.ts";

const msg = (loop: KodoLoop) => kodoLoopStageMessageId(loop, loop.round, loop.stage);

const run = (
  over: Partial<LoopRunView> & Pick<LoopRunView, "runId" | "userMessageId">,
): LoopRunView => ({
  status: "running",
  ...over,
});

const observe = (over: Partial<LoopObservation> = {}): LoopObservation => ({
  threadMode: "plan",
  runs: [],
  outputs: {},
  usage: { costUsd: null, limitPercent: null },
  ...over,
});

/** A loop at `stage` of round `round` whose stage run `r1` is in `status`, with its output. */
const atStage = (
  stage: KodoLoop["stage"],
  status: LoopRunView["status"],
  output: { text: string | null; planMarkdown?: string | null } | undefined,
  loopOver: Partial<KodoLoop> = {},
  obsOver: Partial<LoopObservation> = {},
) => {
  const loop = testLoop({ stage, ...loopOver });
  const observation = observe({
    threadMode: stage === "judge" ? "review" : stage,
    runs: [run({ runId: "r1", userMessageId: msg(loop), status })],
    outputs: output === undefined ? {} : { r1: { planMarkdown: null, ...output } },
    ...obsOver,
  });
  return { loop, observation };
};

describe("stage messages", () => {
  it("ids are derived from the loop, round, stage and attempt", () => {
    const loop = testLoop({ round: 2, stage: "judge" });
    expect(kodoLoopStageMessageId(loop, 2, "judge")).toBe("kodo-loop-L1-r2-judge");
    const retried = testLoop({
      round: 2,
      stage: "judge",
      stages: [testRecord({ round: 2, stage: "judge", status: "failed" })],
    });
    expect(kodoLoopStageMessageId(retried, 2, "judge")).toBe("kodo-loop-L1-r2-judge-a1");
    expect(kodoLoopStageMessageId(retried, 2, "plan")).toBe("kodo-loop-L1-r2-plan");
  });
});

describe("progress", () => {
  it.each([
    ["plan from another mode", "ask", "plan", { kind: "set-mode", mode: "plan" }],
    ["code from plan", "plan", "code", { kind: "set-mode", mode: "code" }],
    ["review from code", "code", "review", { kind: "set-mode", mode: "review" }],
    ["the judge reads in review", "code", "judge", { kind: "set-mode", mode: "review" }],
    ["a legacy default mode is code", "default", "code", "dispatch"],
    ["plan in plan", "plan", "plan", "dispatch"],
    ["the judge in review", "review", "judge", "dispatch"],
  ] as const)("%s: sets the mode, then dispatches", (_name, threadMode, stage, expected) => {
    const loop = testLoop({ stage });
    const step = decideLoopStep(loop, observe({ threadMode }));
    if (expected === "dispatch") {
      expect(step).toEqual({
        kind: "dispatch",
        round: 1,
        stage,
        messageId: msg(loop),
        mode: stage === "judge" ? "review" : stage,
      });
    } else {
      expect(step).toEqual(expected);
    }
  });

  it.each([
    ["queued", "idle"],
    ["preparing", "idle"],
    ["starting", "idle"],
    ["running", "idle"],
  ] as const)("a %s stage run is waited for", (status, kind) => {
    const { loop, observation } = atStage("code", status, undefined);
    expect(decideLoopStep(loop, observation)).toEqual({ kind });
  });

  it("a completed run whose message has not arrived is waited for", () => {
    const { loop, observation } = atStage("code", "completed", undefined);
    expect(decideLoopStep(loop, observation)).toEqual({ kind: "idle" });
  });

  it("a plan settles with its artifact, else its reply, and an empty one is an error", () => {
    const planned = atStage("plan", "completed", { text: "reply", planMarkdown: "## Plan\n1. x" });
    expect(decideLoopStep(planned.loop, planned.observation)).toMatchObject({
      kind: "advance",
      outcome: { stage: "plan", planMarkdown: "## Plan\n1. x", runId: "r1", status: "completed" },
    });
    const replied = atStage("plan", "completed", { text: "  The plan: do x.  " });
    expect(decideLoopStep(replied.loop, replied.observation)).toMatchObject({
      kind: "advance",
      outcome: { planMarkdown: "The plan: do x." },
    });
    const empty = atStage("plan", "completed", { text: " ", planMarkdown: null });
    expect(decideLoopStep(empty.loop, empty.observation)).toMatchObject({
      kind: "finish",
      status: "failed",
      reason: "error",
    });
  });

  it("a plan waits for approval only when the loop asks", () => {
    const ask = atStage("plan", "completed", { text: "plan" }, { planApproval: "ask" });
    expect(decideLoopStep(ask.loop, ask.observation)).toMatchObject({
      kind: "advance",
      hold: "plan_approval",
    });
    const auto = atStage("plan", "completed", { text: "plan" });
    expect(decideLoopStep(auto.loop, auto.observation)).not.toHaveProperty("hold");
  });

  it("a held plan approval waits; an approved loop dispatches code", () => {
    const loop = testLoop({ stage: "code", status: "held", hold: "plan_approval" });
    expect(decideLoopStep(loop, observe({ threadMode: "plan" }))).toEqual({ kind: "idle" });
    const approved = testLoop({ stage: "code" });
    expect(decideLoopStep(approved, observe({ threadMode: "plan" }))).toEqual({
      kind: "set-mode",
      mode: "code",
    });
  });

  it("a code stage advances without reading its report", () => {
    const { loop, observation } = atStage("code", "completed", { text: null });
    expect(decideLoopStep(loop, observation)).toMatchObject({
      kind: "advance",
      outcome: { stage: "code", status: "completed" },
    });
  });

  it("a readable review is kept; an unreadable one degrades instead of stopping", () => {
    const good = atStage("review", "completed", { text: `Fine.\n${reviewBlock(passReview)}` });
    expect(decideLoopStep(good.loop, good.observation)).toMatchObject({
      kind: "advance",
      outcome: { reviewParse: "ok", review: { verdict: "pass" } },
    });
    for (const text of ["Looks good to me.", "```kodo-review\n{nope\n```", null]) {
      const bad = atStage("review", "completed", { text });
      const step = decideLoopStep(bad.loop, bad.observation);
      expect(step).toMatchObject({ kind: "advance", outcome: { reviewParse: "failed" } });
      expect((step as { outcome: object }).outcome).not.toHaveProperty("review");
    }
  });

  it("an incomplete verdict starts the next round", () => {
    const { loop, observation } = atStage("judge", "completed", {
      text: verdictBlock(incompleteVerdict),
    });
    expect(decideLoopStep(loop, observation)).toMatchObject({
      kind: "advance",
      outcome: { stage: "judge", verdict: { complete: false } },
    });
  });
});

describe("stop precedence", () => {
  describe("1. a person's stop, left to clean up", () => {
    const stopped = (over: Partial<KodoLoop> = {}) =>
      testLoop({
        status: "stopped",
        stopReason: "user_stop",
        stage: "code",
        startMode: "ask",
        ...over,
      });

    it("interrupts the loop's own run that is still spending", () => {
      const loop = stopped();
      const observation = observe({
        threadMode: "code",
        runs: [run({ runId: "r1", userMessageId: msg(loop), status: "running" })],
      });
      expect(decideLoopStep(loop, observation)).toEqual({ kind: "interrupt", runId: "r1" });
    });

    it("interrupts a loop run that is waiting on a request, and one a restart continued", () => {
      const loop = stopped();
      const observation = observe({
        threadMode: "code",
        runs: [
          run({ runId: "r1", userMessageId: msg(loop), status: "interrupted" }),
          run({
            runId: "r2",
            userMessageId: "restart-note",
            restartContinuationOfRunId: "r1",
            status: "waiting",
          }),
        ],
      });
      expect(decideLoopStep(loop, observation)).toEqual({ kind: "interrupt", runId: "r2" });
    });

    it("never interrupts a run that is not the loop's, and does not restore the mode under it", () => {
      const loop = stopped();
      const observation = observe({
        threadMode: "code",
        runs: [run({ runId: "other", userMessageId: "m-user", status: "running" })],
      });
      expect(decideLoopStep(loop, observation)).toEqual({ kind: "idle" });
    });

    it("restores the start mode once nothing is running", () => {
      const loop = stopped();
      const observation = observe({
        threadMode: "code",
        runs: [run({ runId: "r1", userMessageId: msg(loop), status: "interrupted" })],
      });
      expect(decideLoopStep(loop, observation)).toEqual({ kind: "restore-mode", mode: "ask" });
      expect(decideLoopStep(loop, { ...observation, threadMode: "ask" })).toEqual({ kind: "idle" });
    });
  });

  describe("after any end", () => {
    it.each([
      ["done", { status: "done", stopReason: "complete" }],
      ["a round cap", { status: "stopped", stopReason: "round_cap" }],
      ["a budget stop", { status: "stopped", stopReason: "budget" }],
      ["an error", { status: "failed", stopReason: "error" }],
    ] as const)("%s restores the start mode when idle", (_name, ended) => {
      const loop = testLoop({ ...ended, stage: "judge", startMode: "plan" });
      expect(decideLoopStep(loop, observe({ threadMode: "review" }))).toEqual({
        kind: "restore-mode",
        mode: "plan",
      });
    });

    it("does not restore while any run is active, nor over a mode the person chose", () => {
      const loop = testLoop({
        status: "done",
        stopReason: "complete",
        stage: "judge",
        startMode: "plan",
      });
      const busy = observe({
        threadMode: "review",
        runs: [run({ runId: "x", userMessageId: "m-user", status: "queued" })],
      });
      expect(decideLoopStep(loop, busy)).toEqual({ kind: "idle" });
      expect(decideLoopStep(loop, observe({ threadMode: "ask" }))).toEqual({ kind: "idle" });
    });

    it("leaves the mode to the message that stopped the loop", () => {
      const loop = testLoop({ status: "stopped", stopReason: "user_message", startMode: "plan" });
      expect(decideLoopStep(loop, observe({ threadMode: "code" }))).toEqual({ kind: "idle" });
    });
  });

  describe("2. error and verdict_invalid", () => {
    it.each([
      ["failed", { status: "failed" }, { status: "failed", reason: "error" }],
      ["interrupted", { status: "interrupted" }, { status: "failed", reason: "error" }],
      ["cancelled", { status: "cancelled" }, { status: "failed", reason: "error" }],
      ["rolled back", { status: "rolled_back" }, { status: "failed", reason: "error" }],
      [
        "failed on a usage limit",
        { status: "failed", usageLimit: true, failureMessage: "Weekly limit reached." },
        { status: "stopped", reason: "provider_limit", detail: "Weekly limit reached." },
      ],
    ] as const)("a stage run that is %s ends the loop", (_name, runOver, expected) => {
      const { loop, observation } = atStage("code", runOver.status, undefined);
      const patched = {
        ...observation,
        runs: observation.runs.map((entry) => ({ ...entry, ...runOver })),
      };
      expect(decideLoopStep(loop, patched)).toMatchObject({
        kind: "finish",
        ...expected,
        outcome: { stage: "code", status: "failed", runId: "r1" },
      });
    });

    it.each([
      ["no block", "All good."],
      ["a block that is not JSON", "```kodo-verdict\nyes\n```"],
      [
        "a complete verdict with something outstanding",
        verdictBlock({ ...completeVerdict, outstanding: incompleteVerdict.outstanding }),
      ],
      ["a block of the wrong kind", reviewBlock(passReview)],
    ])("an unreadable judge answer (%s) fails closed", (_name, text) => {
      const { loop, observation } = atStage("judge", "completed", { text });
      expect(decideLoopStep(loop, observation)).toMatchObject({
        kind: "finish",
        status: "failed",
        reason: "verdict_invalid",
        outcome: { stage: "judge", status: "failed" },
      });
    });

    it("beats a person's message and a complete verdict elsewhere", () => {
      const failed = atStage("code", "failed", undefined);
      const withForeign = {
        ...failed.observation,
        runs: [...failed.observation.runs, run({ runId: "x", userMessageId: "m-user" })],
      };
      expect(decideLoopStep(failed.loop, withForeign)).toMatchObject({ reason: "error" });
      const invalid = atStage("judge", "completed", { text: "nothing" });
      const invalidWithForeign = {
        ...invalid.observation,
        runs: [
          ...invalid.observation.runs,
          run({ runId: "x", userMessageId: "m-user", status: "queued" }),
        ],
      };
      expect(decideLoopStep(invalid.loop, invalidWithForeign)).toMatchObject({
        reason: "verdict_invalid",
      });
    });
  });

  describe("3. user_message", () => {
    it.each(["queued", "running", "waiting", "starting", "preparing"] as const)(
      "a %s run that is not the loop's stops it",
      (status) => {
        const loop = testLoop({ stage: "code" });
        const observation = observe({
          threadMode: "code",
          runs: [
            run({ runId: "r1", userMessageId: msg(loop), status: "running" }),
            run({ runId: "x", userMessageId: "m-user", status }),
          ],
        });
        expect(decideLoopStep(loop, observation)).toMatchObject({
          kind: "finish",
          status: "stopped",
          reason: "user_message",
        });
      },
    );

    it("a finished run that is not the loop's does not", () => {
      const loop = testLoop({ stage: "code" });
      const observation = observe({
        threadMode: "code",
        runs: [
          run({ runId: "old", userMessageId: "m-old", status: "completed" }),
          run({ runId: "r1", userMessageId: msg(loop), status: "running" }),
        ],
      });
      expect(decideLoopStep(loop, observation)).toEqual({ kind: "idle" });
    });

    it("beats the round cap and the budget", () => {
      const { loop, observation } = atStage(
        "judge",
        "completed",
        { text: verdictBlock(incompleteVerdict) },
        { round: 3, budget: { stopAtLimitPercent: 50 } },
        { usage: { costUsd: null, limitPercent: 99 } },
      );
      const withForeign = {
        ...observation,
        runs: [...observation.runs, run({ runId: "x", userMessageId: "m-user", status: "queued" })],
      };
      expect(decideLoopStep(loop, withForeign)).toMatchObject({ reason: "user_message" });
    });

    it("loses to a complete verdict that settled at the same time", () => {
      const { loop, observation } = atStage(
        "judge",
        "completed",
        { text: verdictBlock(completeVerdict) },
        { round: 3, budget: { stopAtLimitPercent: 50 } },
        { usage: { costUsd: null, limitPercent: 99 } },
      );
      const withForeign = {
        ...observation,
        runs: [...observation.runs, run({ runId: "x", userMessageId: "m-user", status: "queued" })],
      };
      expect(decideLoopStep(loop, withForeign)).toMatchObject({
        kind: "finish",
        status: "done",
        reason: "complete",
      });
    });

    describe("a message that began and ended between two looks", () => {
      const loopAfter = (over: Partial<KodoLoop> = {}) =>
        testLoop({ stage: "code", baseline: { runOrdinal: 4 }, ...over });

      it("stops the loop when its run is already over", () => {
        const loop = loopAfter();
        const observation = observe({
          threadMode: "code",
          runs: [
            run({ runId: "r1", userMessageId: msg(loop), status: "running", ordinal: 5 }),
            run({ runId: "x", userMessageId: "m-user", status: "completed", ordinal: 6 }),
          ],
        });
        expect(decideLoopStep(loop, observation)).toMatchObject({
          kind: "finish",
          status: "stopped",
          reason: "user_message",
        });
      });

      it.each(["failed", "cancelled", "interrupted"] as const)("also when it %s", (status) => {
        const loop = loopAfter();
        const observation = observe({
          threadMode: "code",
          runs: [
            run({ runId: "r1", userMessageId: msg(loop), status: "running", ordinal: 5 }),
            run({ runId: "x", userMessageId: "m-user", status, ordinal: 6 }),
          ],
        });
        expect(decideLoopStep(loop, observation)).toMatchObject({ reason: "user_message" });
      });

      it("does not read the runs from before the loop, or the loop's own, as a person's", () => {
        const loop = loopAfter();
        const observation = observe({
          threadMode: "code",
          runs: [
            run({ runId: "old", userMessageId: "m-old", status: "completed", ordinal: 4 }),
            run({ runId: "r1", userMessageId: msg(loop), status: "completed", ordinal: 5 }),
          ],
        });
        expect(decideLoopStep(loop, observation)).toEqual({ kind: "idle" });
      });

      it("does not read a restart continuation of the loop's run as a person's", () => {
        const loop = loopAfter();
        const observation = observe({
          threadMode: "code",
          runs: [
            run({ runId: "r1", userMessageId: msg(loop), status: "cancelled", ordinal: 5 }),
            run({
              runId: "r2",
              userMessageId: "restart-note",
              restartContinuationOfRunId: "r1",
              status: "running",
              ordinal: 6,
            }),
          ],
        });
        expect(decideLoopStep(loop, observation)).toEqual({ kind: "idle" });
      });

      it("is not noticed by a loop that recorded no starting point", () => {
        const loop = testLoop({ stage: "code" });
        const observation = observe({
          threadMode: "code",
          runs: [
            run({ runId: "r1", userMessageId: msg(loop), status: "running", ordinal: 5 }),
            run({ runId: "x", userMessageId: "m-user", status: "completed", ordinal: 6 }),
          ],
        });
        expect(decideLoopStep(loop, observation)).toEqual({ kind: "idle" });
      });
    });

    it("a request message and the loop's earlier stage messages are the loop's own", () => {
      const loop = testLoop({
        stage: "review",
        stages: [testRecord({ round: 1, stage: "plan" }), testRecord({ round: 1, stage: "code" })],
      });
      const observation = observe({
        threadMode: "review",
        runs: [
          run({ runId: "q", userMessageId: "m-request", status: "completed" }),
          run({ runId: "p", userMessageId: "kodo-loop-L1-r1-plan", status: "completed" }),
          run({ runId: "c", userMessageId: "kodo-loop-L1-r1-code", status: "running" }),
        ],
      });
      expect(decideLoopStep(loop, observation)).toEqual({
        kind: "dispatch",
        round: 1,
        stage: "review",
        messageId: "kodo-loop-L1-r1-review",
        mode: "review",
      });
    });
  });

  describe("loop membership through a restart-continuation chain", () => {
    it("a run a restart started is the stage's run, not a person's message", () => {
      const loop = testLoop({ stage: "code" });
      const chain = [
        run({ runId: "r1", userMessageId: msg(loop), status: "interrupted" }),
        run({
          runId: "r2",
          userMessageId: "restart-note-1",
          restartContinuationOfRunId: "r1",
          status: "interrupted",
        }),
        run({
          runId: "r3",
          userMessageId: "restart-note-2",
          restartContinuationOfRunId: "r2",
          status: "running",
        }),
      ];
      expect(decideLoopStep(loop, observe({ threadMode: "code", runs: chain }))).toEqual({
        kind: "idle",
      });
    });

    it("the end of the chain decides: a completed continuation settles the stage", () => {
      const loop = testLoop({ stage: "code" });
      const chain = [
        run({ runId: "r1", userMessageId: msg(loop), status: "interrupted" }),
        run({
          runId: "r2",
          userMessageId: "restart-note",
          restartContinuationOfRunId: "r1",
          status: "completed",
        }),
      ];
      expect(
        decideLoopStep(
          loop,
          observe({
            threadMode: "code",
            runs: chain,
            outputs: { r2: { text: "done", planMarkdown: null } },
          }),
        ),
      ).toMatchObject({ kind: "advance", outcome: { runId: "r2" } });
    });

    it("a run a restart ended waits for its continuation, which is created after the restart", () => {
      const loop = testLoop({ stage: "code" });
      const ended = (continuationPending: boolean) =>
        observe({
          threadMode: "code",
          runs: [
            run({
              runId: "r1",
              userMessageId: msg(loop),
              status: "cancelled",
              continuationPending,
            }),
          ],
        });
      expect(decideLoopStep(loop, ended(true))).toEqual({ kind: "idle" });
      // The continuation was declined or could not start: now the stage really failed.
      expect(decideLoopStep(loop, ended(false))).toMatchObject({ kind: "finish", reason: "error" });
    });

    it("an interrupted stage run is an error only when nothing continued it", () => {
      const loop = testLoop({ stage: "code" });
      const alone = [run({ runId: "r1", userMessageId: msg(loop), status: "interrupted" })];
      expect(decideLoopStep(loop, observe({ threadMode: "code", runs: alone }))).toMatchObject({
        kind: "finish",
        reason: "error",
      });
    });

    it("the same message-less run is a person's when no link ties it to the loop", () => {
      const loop = testLoop({ stage: "code" });
      const runs = [
        run({ runId: "r1", userMessageId: msg(loop), status: "running" }),
        run({ runId: "r2", userMessageId: "restart-note", status: "running" }),
      ];
      expect(decideLoopStep(loop, observe({ threadMode: "code", runs }))).toMatchObject({
        reason: "user_message",
      });
    });

    it("a continuation of an earlier stage's run is not read as a person's message", () => {
      const loop = testLoop({ stage: "review", stages: [testRecord({ round: 1, stage: "plan" })] });
      const runs = [
        run({ runId: "p1", userMessageId: "kodo-loop-L1-r1-plan", status: "interrupted" }),
        run({
          runId: "p2",
          userMessageId: "restart-note",
          restartContinuationOfRunId: "p1",
          status: "running",
        }),
      ];
      expect(decideLoopStep(loop, observe({ threadMode: "review", runs }))).toEqual({
        kind: "dispatch",
        round: 1,
        stage: "review",
        messageId: "kodo-loop-L1-r1-review",
        mode: "review",
      });
    });
  });

  describe("4. complete, 5. round_cap, 6. budget", () => {
    const tripped = { usage: { costUsd: null, limitPercent: 95 } };

    it("a complete verdict ends the loop and beats the round cap and the budget", () => {
      const { loop, observation } = atStage(
        "judge",
        "completed",
        { text: verdictBlock(completeVerdict) },
        { round: 3 },
        tripped,
      );
      expect(decideLoopStep(loop, observation)).toMatchObject({
        kind: "finish",
        status: "done",
        reason: "complete",
        outcome: { verdict: { complete: true } },
      });
    });

    it("an incomplete verdict at the last round stops at the cap, ahead of the budget", () => {
      const { loop, observation } = atStage(
        "judge",
        "completed",
        { text: verdictBlock(incompleteVerdict) },
        { round: 3 },
        tripped,
      );
      expect(decideLoopStep(loop, observation)).toMatchObject({
        kind: "finish",
        status: "stopped",
        reason: "round_cap",
        outcome: { verdict: { complete: false } },
      });
    });

    it("an incomplete verdict before the cap moves on, and the budget is read at the next gap", () => {
      const { loop, observation } = atStage(
        "judge",
        "completed",
        { text: verdictBlock(incompleteVerdict) },
        { round: 2 },
        tripped,
      );
      expect(decideLoopStep(loop, observation)).toMatchObject({ kind: "advance" });
      const next = testLoop({ round: 3, stage: "plan" });
      expect(decideLoopStep(next, observe({ ...tripped, threadMode: "review" }))).toMatchObject({
        kind: "finish",
        status: "stopped",
        reason: "budget",
      });
    });

    it.each([
      [
        "the provider limit",
        { budget: { stopAtLimitPercent: 90 } },
        { costUsd: null, limitPercent: 90 },
        "90%",
      ],
      [
        "the cost cap",
        { budget: { maxCostUsd: 1.5 } },
        { costUsd: 1.5, limitPercent: null },
        "$1.50",
      ],
      [
        "the token cap",
        {
          budget: { maxTokens: 1000 },
          stages: [
            testRecord({
              round: 1,
              stage: "plan",
              usage: {
                uncachedInputTokens: 300,
                cachedInputTokens: 300,
                cacheCreationTokens: 100,
                outputTokens: 300,
                reasoningTokens: 200,
                complete: true,
              },
            }),
          ],
        },
        { costUsd: null, limitPercent: null },
        "1,000",
      ],
    ] as const)("stops between stages at %s", (_name, loopOver, usage, text) => {
      const loop = testLoop({ stage: "code", ...loopOver });
      const step = decideLoopStep(loop, observe({ threadMode: "code", usage }));
      expect(step).toMatchObject({ kind: "finish", status: "stopped", reason: "budget" });
      expect((step as { detail: string }).detail).toContain(text);
    });

    it.each([
      [
        "a limit reading that is not known",
        { budget: { stopAtLimitPercent: 90 } },
        { costUsd: null, limitPercent: null },
      ],
      [
        "a limit under the line",
        { budget: { stopAtLimitPercent: 90 } },
        { costUsd: null, limitPercent: 89 },
      ],
      ["no limit configured", { budget: {} }, { costUsd: 99, limitPercent: 99 }],
      ["a cost not known", { budget: { maxCostUsd: 1 } }, { costUsd: null, limitPercent: null }],
    ] as const)("does not stop on %s", (_name, loopOver, usage) => {
      const loop = testLoop({ stage: "code", ...loopOver });
      expect(decideLoopStep(loop, observe({ threadMode: "code", usage }))).toMatchObject({
        kind: "dispatch",
      });
    });

    it("does not interrupt a stage in flight", () => {
      const { loop, observation } = atStage(
        "code",
        "running",
        undefined,
        {},
        { usage: { costUsd: null, limitPercent: 99 } },
      );
      expect(decideLoopStep(loop, observation)).toEqual({ kind: "idle" });
    });
  });

  describe("7. holds", () => {
    it("a run waiting on a request holds the loop once", () => {
      const waiting = atStage("code", "waiting", undefined);
      expect(decideLoopStep(waiting.loop, waiting.observation)).toEqual({
        kind: "hold",
        hold: "runtime_request",
      });
      const held = atStage("code", "waiting", undefined, {
        status: "held",
        hold: "runtime_request",
      });
      expect(decideLoopStep(held.loop, held.observation)).toEqual({ kind: "idle" });
    });

    it("answering the request releases the hold", () => {
      const { loop, observation } = atStage("code", "running", undefined, {
        status: "held",
        hold: "runtime_request",
      });
      expect(decideLoopStep(loop, observation)).toEqual({ kind: "release" });
    });

    it("a held stage that completed still settles", () => {
      const { loop, observation } = atStage(
        "code",
        "completed",
        { text: "done" },
        { status: "held", hold: "runtime_request" },
      );
      expect(decideLoopStep(loop, observation)).toMatchObject({ kind: "advance" });
    });

    it("the budget is read before a plan approval wait", () => {
      const loop = testLoop({ stage: "code", status: "held", hold: "plan_approval" });
      expect(
        decideLoopStep(loop, observe({ usage: { costUsd: null, limitPercent: 95 } })),
      ).toMatchObject({
        reason: "budget",
      });
    });
  });
});

describe("a retried judge", () => {
  it("is a new attempt with its own message, so the unreadable answer is not read again", () => {
    const loop = testLoop({
      stage: "judge",
      stages: [testRecord({ round: 1, stage: "judge", status: "failed" })],
    });
    const observation = observe({
      threadMode: "review",
      runs: [run({ runId: "old", userMessageId: "kodo-loop-L1-r1-judge", status: "completed" })],
      outputs: { old: { text: "garbage", planMarkdown: null } },
    });
    expect(decideLoopStep(loop, observation)).toEqual({
      kind: "dispatch",
      round: 1,
      stage: "judge",
      messageId: "kodo-loop-L1-r1-judge-a1",
      mode: "review",
    });
  });
});
