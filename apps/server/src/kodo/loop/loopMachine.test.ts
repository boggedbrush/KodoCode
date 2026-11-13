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
  budget: { limit: { state: "unchecked" } },
  ...over,
});

const limitAt = (percent: number): Pick<LoopObservation, "budget"> => ({
  budget: { limit: { state: "ok", percent, provider: "Claude", window: "5-hour" } },
});

const usageOf = (over: Partial<NonNullable<KodoLoop["stages"][number]["usage"]>> = {}) => ({
  uncachedInputTokens: 300,
  cachedInputTokens: 300,
  cacheCreationTokens: 100,
  outputTokens: 300,
  reasoningTokens: 200,
  complete: true,
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
    for (const text of [
      "Looks good to me.",
      "```kodo-review\n{nope\n```",
      // A block that is not the end of the reply, or a second block, is unreadable too.
      `${reviewBlock(passReview)}\n\nAnything else?`,
      `${reviewBlock(passReview)}\n${reviewBlock(passReview)}`,
    ]) {
      const bad = atStage("review", "completed", { text });
      const step = decideLoopStep(bad.loop, bad.observation);
      expect(step).toMatchObject({ kind: "advance", outcome: { reviewParse: "failed" } });
      expect((step as { outcome: object }).outcome).not.toHaveProperty("review");
    }
  });

  it.each([
    ["plan", { text: null, planMarkdown: null }, "error"],
    ["review", { text: null }, "error"],
    ["judge", { text: null }, "verdict_invalid"],
    ["judge", { text: "   " }, "verdict_invalid"],
  ] as const)(
    "a completed %s run with no usable reply ends the loop instead of waiting for ever",
    (stage, output, reason) => {
      const { loop, observation } = atStage(stage, "completed", output);
      expect(decideLoopStep(loop, observation)).toMatchObject({
        kind: "finish",
        status: "failed",
        reason,
        detail: expect.stringMatching(/without/),
      });
    },
  );

  it("a run whose reply is still streaming is waited for, not read", () => {
    const { loop, observation } = atStage("plan", "completed", undefined);
    expect(decideLoopStep(loop, observation)).toEqual({ kind: "idle" });
  });

  it("each settled stage carries one conclusion line for its record", () => {
    const planned = atStage("plan", "completed", { text: "## Plan\n1. Do x.\n2. Do y." });
    expect(decideLoopStep(planned.loop, planned.observation)).toMatchObject({
      outcome: { conclusion: "Plan" },
    });
    const coded = atStage("code", "completed", { text: "Changed the parser.\nChecks pass." });
    expect(decideLoopStep(coded.loop, coded.observation)).toMatchObject({
      outcome: { conclusion: "Changed the parser." },
    });
    const judged = atStage("judge", "completed", { text: verdictBlock(incompleteVerdict) });
    expect(decideLoopStep(judged.loop, judged.observation)).toMatchObject({
      outcome: { conclusion: incompleteVerdict.summary },
    });
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
  describe("1. an ended loop's clean-up, owed from the end and recorded on the loop", () => {
    const stopped = (over: Partial<KodoLoop> = {}) =>
      testLoop({
        status: "stopped",
        stopReason: "user_stop",
        stage: "code",
        startMode: "ask",
        cleanup: { leftMode: "code", interrupt: true },
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

    it("restores the start mode once nothing is running, then reports itself done", () => {
      const loop = stopped();
      const observation = observe({
        threadMode: "code",
        runs: [run({ runId: "r1", userMessageId: msg(loop), status: "interrupted" })],
      });
      expect(decideLoopStep(loop, observation)).toEqual({ kind: "restore-mode", mode: "ask" });
      expect(decideLoopStep(loop, { ...observation, threadMode: "ask" })).toEqual({
        kind: "cleaned",
      });
    });

    describe("the stage that was running when a person ended the loop", () => {
      const owing = (over: Partial<KodoLoop> = {}) =>
        stopped({ cleanup: { leftMode: "code", interrupt: true, record: true }, ...over });

      it("is recorded once its run has settled, after the loop's own run was interrupted", () => {
        const loop = owing();
        const live = observe({
          threadMode: "code",
          runs: [run({ runId: "r1", userMessageId: msg(loop), status: "running" })],
        });
        expect(decideLoopStep(loop, live)).toEqual({ kind: "interrupt", runId: "r1" });
        const ended = observe({
          threadMode: "code",
          runs: [run({ runId: "r1", userMessageId: msg(loop), status: "interrupted" })],
        });
        expect(decideLoopStep(loop, ended)).toEqual({
          kind: "record-stage",
          outcome: {
            round: 1,
            stage: "code",
            messageId: msg(loop),
            runId: "r1",
            status: "interrupted",
          },
        });
      });

      it("waits for a run a person's message steered, and for a restart's continuation to exist", () => {
        const loop = owing({
          stopReason: "user_message",
          cleanup: { record: true },
        });
        const steered = observe({
          threadMode: "code",
          runs: [run({ runId: "r1", userMessageId: msg(loop), status: "running" })],
        });
        expect(decideLoopStep(loop, steered)).toEqual({ kind: "idle" });
        const restarting = observe({
          threadMode: "code",
          runs: [
            run({
              runId: "r1",
              userMessageId: msg(loop),
              status: "interrupted",
              continuationPending: true,
            }),
          ],
        });
        expect(decideLoopStep(loop, restarting)).toEqual({ kind: "idle" });
      });

      it("settles with nothing to record when the stage never got a run", () => {
        expect(decideLoopStep(owing(), observe({ threadMode: "code" }))).toEqual({
          kind: "record-stage",
        });
      });

      it("follows a restart chain to the run that carried the stage last", () => {
        const loop = owing();
        const chain = observe({
          threadMode: "code",
          runs: [
            run({ runId: "r1", userMessageId: msg(loop), status: "interrupted" }),
            run({
              runId: "r2",
              userMessageId: "note",
              restartContinuationOfRunId: "r1",
              status: "interrupted",
            }),
          ],
        });
        expect(decideLoopStep(loop, chain)).toMatchObject({
          kind: "record-stage",
          outcome: { runId: "r2" },
        });
      });
    });

    it("a loop that owes nothing has nothing to look at", () => {
      const loop = testLoop({ status: "done", stopReason: "complete" });
      expect(decideLoopStep(loop, observe({ threadMode: "review" }))).toEqual({ kind: "idle" });
    });
  });

  describe("after any end", () => {
    it.each([
      ["done", { status: "done", stopReason: "complete" }],
      ["a round cap", { status: "stopped", stopReason: "round_cap" }],
      ["a budget stop", { status: "stopped", stopReason: "budget" }],
      ["an error", { status: "failed", stopReason: "error" }],
      [
        "a person's message that was steered into the run",
        { status: "stopped", stopReason: "user_message" },
      ],
    ] as const)("%s restores the start mode when idle", (_name, ended) => {
      const loop = testLoop({
        ...ended,
        stage: "judge",
        startMode: "plan",
        cleanup: { leftMode: "review" },
      });
      expect(decideLoopStep(loop, observe({ threadMode: "review" }))).toEqual({
        kind: "restore-mode",
        mode: "plan",
      });
    });

    it("waits while any run is active, so a steer's run settles first", () => {
      const loop = testLoop({
        status: "stopped",
        stopReason: "user_message",
        stage: "code",
        startMode: "plan",
        cleanup: { leftMode: "code" },
      });
      const busy = observe({
        threadMode: "code",
        runs: [run({ runId: "r1", userMessageId: msg(loop), status: "running" })],
      });
      expect(decideLoopStep(loop, busy)).toEqual({ kind: "idle" });
      expect(
        decideLoopStep(
          loop,
          observe({
            threadMode: "code",
            runs: [run({ runId: "r1", userMessageId: msg(loop), status: "completed" })],
          }),
        ),
      ).toEqual({ kind: "restore-mode", mode: "plan" });
    });

    it("leaves a mode a person chose since the loop ended", () => {
      const loop = testLoop({
        status: "done",
        stopReason: "complete",
        stage: "judge",
        startMode: "plan",
        cleanup: { leftMode: "review" },
      });
      expect(decideLoopStep(loop, observe({ threadMode: "ask" }))).toEqual({ kind: "cleaned" });
      expect(decideLoopStep(loop, observe({ threadMode: "plan" }))).toEqual({ kind: "cleaned" });
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
  });

  describe("3. turns that are not the loop's (a person's message ends the loop before this)", () => {
    it("does not read a run that is not the loop's as an end of the loop", () => {
      const loop = testLoop({ stage: "code" });
      const observation = observe({
        threadMode: "code",
        runs: [
          run({ runId: "old", userMessageId: "m-old", status: "completed" }),
          run({ runId: "r1", userMessageId: msg(loop), status: "running" }),
          run({ runId: "wake", userMessageId: "m-wake", status: "queued" }),
        ],
      });
      expect(decideLoopStep(loop, observation)).toEqual({ kind: "idle" });
    });

    it.each(["queued", "running", "waiting", "starting", "preparing"] as const)(
      "a %s wake between stages is waited out before the next stage's mode is set or sent",
      (status) => {
        const loop = testLoop({
          stage: "review",
          stages: [testRecord({ round: 1, stage: "code" })],
        });
        const wake = run({ runId: "wake", userMessageId: "m-wake", status });
        // In the thread's old mode, nothing is changed under the wake...
        expect(decideLoopStep(loop, observe({ threadMode: "code", runs: [wake] }))).toEqual({
          kind: "idle",
        });
        // ...and in the stage's own mode, nothing starts behind it either.
        expect(decideLoopStep(loop, observe({ threadMode: "review", runs: [wake] }))).toEqual({
          kind: "idle",
        });
        // Once it has finished, the loop goes on.
        expect(
          decideLoopStep(
            loop,
            observe({ threadMode: "code", runs: [{ ...wake, status: "completed" }] }),
          ),
        ).toEqual({ kind: "set-mode", mode: "review" });
      },
    );

    it("a goal command or an interrupt-restart that cut the stage run is an error only if the loop is still running", () => {
      // The orchestrator ended the loop as user_message in the message's own commit, so by the time a
      // look sees the cut run the loop is over and owes only its clean-up.
      const loop = testLoop({
        status: "stopped",
        stopReason: "user_message",
        stage: "code",
        startMode: "ask",
        cleanup: { leftMode: "code" },
      });
      const observation = observe({
        threadMode: "code",
        runs: [run({ runId: "r1", userMessageId: msg(loop), status: "interrupted" })],
      });
      expect(decideLoopStep(loop, observation)).toEqual({ kind: "restore-mode", mode: "ask" });
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

    it("a run no link ties to the loop is not its own: it is waited out, and never interrupted", () => {
      const loop = testLoop({ stage: "code" });
      const runs = [
        run({ runId: "r1", userMessageId: msg(loop), status: "running" }),
        run({ runId: "r2", userMessageId: "restart-note", status: "running" }),
      ];
      expect(decideLoopStep(loop, observe({ threadMode: "code", runs }))).toEqual({ kind: "idle" });
      const ended = testLoop({
        stage: "code",
        status: "stopped",
        stopReason: "user_stop",
        cleanup: { interrupt: true },
      });
      expect(decideLoopStep(ended, observe({ threadMode: "code", runs: runs.slice(1) }))).toEqual({
        kind: "idle",
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
    const tripped = limitAt(95);

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
        limitAt(90),
        "Claude 5-hour window at 90%, limit 90%.",
      ],
      [
        "the cost cap",
        {
          budget: { maxCostUsd: 1.5 },
          stages: [testRecord({ round: 1, stage: "plan", usage: usageOf({ costUsd: 1.5 }) })],
        },
        {},
        "$1.50",
      ],
      [
        "the cost cap, counting only the stages that have a price",
        {
          budget: { maxCostUsd: 1 },
          stages: [
            testRecord({ round: 1, stage: "plan", usage: usageOf({ costUsd: 1.25 }) }),
            testRecord({ round: 1, stage: "code", usage: usageOf() }),
          ],
        },
        {},
        "stages without a price are not counted",
      ],
      [
        "the token cap",
        {
          budget: { maxTokens: 700 },
          stages: [testRecord({ round: 1, stage: "plan", usage: usageOf() })],
        },
        {},
        "700 tokens (cache reads are not counted), at the 700 cap",
      ],
    ] as const)("stops between stages at %s", (_name, loopOver, obs, text) => {
      const loop = testLoop({ stage: "code", ...loopOver });
      const step = decideLoopStep(loop, observe({ threadMode: "code", ...obs }));
      expect(step).toMatchObject({ kind: "finish", status: "stopped", reason: "budget" });
      expect((step as { detail: string }).detail).toContain(text);
    });

    it.each([
      ["a limit under the line", { budget: { stopAtLimitPercent: 90 } }, limitAt(89)],
      ["no limit configured", { budget: {} }, limitAt(99)],
      [
        "a cost that is not known",
        {
          budget: { maxCostUsd: 1 },
          stages: [testRecord({ round: 1, stage: "plan", usage: usageOf() })],
        },
        {},
      ],
      [
        "a priced cost under the cap with an unpriced stage beside it",
        {
          budget: { maxCostUsd: 1 },
          stages: [
            testRecord({ round: 1, stage: "plan", usage: usageOf({ costUsd: 0.4 }) }),
            testRecord({ round: 1, stage: "code", usage: usageOf() }),
          ],
        },
        {},
      ],
      [
        "stages that reported no tokens",
        { budget: { maxTokens: 10 }, stages: [testRecord({ round: 1, stage: "plan" })] },
        {},
      ],
    ] as const)("does not stop on %s", (_name, loopOver, obs) => {
      const loop = testLoop({ stage: "code", ...loopOver });
      expect(decideLoopStep(loop, observe({ threadMode: "code", ...obs }))).toMatchObject({
        kind: "dispatch",
      });
    });

    it("a gate that could not be read stops the loop instead of spending unchecked", () => {
      const loop = testLoop({ stage: "code" });
      const step = decideLoopStep(
        loop,
        observe({
          threadMode: "code",
          budget: { limit: { state: "unchecked" }, error: "the provider list failed" },
        }),
      );
      expect(step).toMatchObject({ kind: "finish", status: "stopped", reason: "budget" });
      expect((step as { detail: string }).detail).toContain("the provider list failed");
      expect((step as { detail: string }).detail).toContain("stopped instead of spending");
    });

    describe("a limit reading that cannot be used does not stop the loop, but is recorded once", () => {
      const missing = (state: "missing" | "stale") =>
        observe({ threadMode: "code", budget: { limit: { state, provider: "Claude" } } });

      it.each(["missing", "stale"] as const)("%s", (state) => {
        const loop = testLoop({ stage: "code" });
        expect(decideLoopStep(loop, missing(state))).toEqual({
          kind: "limit-check",
          limitCheck: { state, provider: "Claude" },
        });
        const noted = testLoop({
          stage: "code",
          limitCheck: { state, provider: "Claude", unchecked: [{ round: 1, stage: "code" }] },
        });
        expect(decideLoopStep(noted, missing(state))).toMatchObject({ kind: "dispatch" });
      });

      it("a stage that is not on the list is recorded too, so the summary can count them", () => {
        const noted = testLoop({
          stage: "code",
          limitCheck: {
            state: "stale",
            provider: "Claude",
            unchecked: [{ round: 1, stage: "plan" }],
          },
        });
        expect(decideLoopStep(noted, missing("stale"))).toMatchObject({ kind: "limit-check" });
      });

      it("a reading that comes back does not erase the note: the loop just goes on", () => {
        const noted = testLoop({
          stage: "code",
          limitCheck: {
            state: "stale",
            provider: "Claude",
            unchecked: [{ round: 1, stage: "plan" }],
          },
        });
        expect(decideLoopStep(noted, observe({ threadMode: "code", ...limitAt(10) }))).toMatchObject({
          kind: "dispatch",
        });
      });
    });

    it("does not interrupt a stage in flight", () => {
      const { loop, observation } = atStage("code", "running", undefined, {}, limitAt(99));
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
      expect(decideLoopStep(loop, observe(limitAt(95)))).toMatchObject({ reason: "budget" });
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
