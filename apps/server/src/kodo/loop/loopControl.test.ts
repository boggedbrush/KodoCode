import { describe, expect, it } from "@effect/vitest";
import { CheckpointId, MessageId, type KodoLoopControl } from "@t3tools/contracts";

import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import {
  decideKodoLoopAdvance,
  decideKodoLoopControl,
  decideKodoLoopMessage,
  kodoLoopBlocksContinuation,
  kodoLoopLimitRefusal,
  kodoLoopModeSetRefusal,
  kodoLoopStartRefusal,
  validKodoLoopStage,
} from "./loopControl.ts";
import { kodoLoopStageMessageId } from "./loopMachine.ts";
import { testLoop, testRecord } from "./testing.ts";

const start: KodoLoopControl = {
  type: "start",
  request: "Do it.",
  requestMessageId: MessageId.make("m1"),
  maxRounds: 2,
  planApproval: "auto",
  budget: {},
};
const run = (status: string, ordinal: number, checkpoint = false) =>
  ({
    status,
    ordinal,
    checkpointId: checkpoint ? CheckpointId.make(`c${ordinal}`) : null,
  }) as Parameters<typeof decideKodoLoopControl>[0]["runs"][number];
const thread = (
  over: Parameters<typeof decideKodoLoopControl>[0]["thread"] = { interactionMode: "plan" },
) => over;

describe("starting", () => {
  it("records the thread's mode, and where its runs and checkpoints stood", () => {
    const result = decideKodoLoopControl({
      commandId: "cmd-1",
      control: start,
      thread: thread(),
      runs: [run("completed", 1, true), run("completed", 2, true), run("cancelled", 3)],
    });
    expect(result).toMatchObject({
      ok: true,
      loop: {
        loopId: "cmd-1",
        startMode: "plan",
        baseline: { checkpointTurnCount: 2 },
      },
    });
  });

  it.each(["queued", "preparing", "starting", "running", "waiting"])(
    "is refused while a %s run is on the thread",
    (status) => {
      const result = decideKodoLoopControl({
        commandId: "c",
        control: start,
        thread: thread(),
        runs: [run(status, 1)],
      });
      expect(result).toMatchObject({
        ok: false,
        message: expect.stringContaining("A turn is running"),
      });
    },
  );

  it("keeps the mode a loop started in when the one before it left the thread in a stage mode", () => {
    const ended = testLoop({
      status: "stopped",
      stopReason: "user_message",
      startMode: "ask",
      cleanup: { leftMode: "code" },
    });
    const result = decideKodoLoopControl({
      commandId: "c",
      control: start,
      thread: thread({ interactionMode: "code", kodoLoop: ended }),
      runs: [],
    });
    expect(result).toMatchObject({ ok: true, loop: { startMode: "ask" } });
  });

  it("is refused while a loop is running, and allowed after it ended", () => {
    const refused = decideKodoLoopControl({
      commandId: "c",
      control: start,
      thread: thread({ interactionMode: "code", kodoLoop: testLoop() }),
      runs: [],
    });
    expect(refused).toMatchObject({ ok: false, reason: "loop_exists" });
    const allowed = decideKodoLoopControl({
      commandId: "c2",
      control: start,
      thread: thread({ interactionMode: "code", kodoLoop: testLoop({ status: "done" }) }),
      runs: [],
    });
    expect(allowed).toMatchObject({ ok: true, loop: { loopId: "c2", revision: 1 } });
  });
});

describe("resuming", () => {
  const capped = testLoop({
    status: "stopped",
    stopReason: "round_cap",
    stage: "judge",
    cleanup: { leftMode: "review" },
  });

  it("runs another round, and drops a clean-up the resumed loop no longer owes", () => {
    const result = decideKodoLoopControl({
      commandId: "c",
      control: { type: "extend", rounds: 2 },
      thread: thread({ interactionMode: "review", kodoLoop: capped }),
      runs: [run("completed", 9)],
    });
    expect(result).toMatchObject({ ok: true, loop: { round: 2, maxRounds: 5 } });
    expect(result.ok && result.loop.cleanup).toBeUndefined();
  });

  it("is refused while a turn runs", () => {
    const result = decideKodoLoopControl({
      commandId: "c",
      control: { type: "extend", rounds: 2 },
      thread: thread({ interactionMode: "code", kodoLoop: capped }),
      runs: [run("running", 9)],
    });
    expect(result).toMatchObject({ ok: false });
  });
});

describe("the worker's writes", () => {
  it("are refused when the revision is stale or the loop is another", () => {
    const loop = testLoop({ revision: 4 });
    const step = { type: "release" } as const;
    const base = { thread: thread({ interactionMode: "plan", kodoLoop: loop }), step };
    expect(decideKodoLoopAdvance({ ...base, loopId: "L1", expectedRevision: 3 })).toMatchObject({
      ok: false,
      reason: "stale_revision",
    });
    expect(decideKodoLoopAdvance({ ...base, loopId: "other", expectedRevision: 4 })).toMatchObject({
      ok: false,
      reason: "wrong_loop",
    });
  });

  it("are refused on a thread without a loop", () => {
    expect(
      decideKodoLoopAdvance({
        loopId: "L1",
        expectedRevision: 1,
        step: { type: "release" },
        thread: thread(),
      }),
    ).toMatchObject({ ok: false, reason: "no_loop" });
  });
});

describe("a message's claim to be a loop stage", () => {
  const loop = testLoop({ stage: "judge", stages: [testRecord({ round: 1, stage: "review" })] });
  const messageId = kodoLoopStageMessageId(loop, 1, "judge");
  const claim = { loopId: "L1", round: 1, stage: "judge" } as const;

  it("is honoured only for the active loop's current stage and its own message", () => {
    expect(validKodoLoopStage(loop, { messageId, kodoLoopStage: claim })).toEqual(claim);
    expect(
      validKodoLoopStage(loop, { messageId: "message-a-client-made", kodoLoopStage: claim }),
    ).toBeUndefined();
    expect(
      validKodoLoopStage(loop, { messageId, kodoLoopStage: { ...claim, loopId: "x" } }),
    ).toBeUndefined();
    expect(
      validKodoLoopStage(loop, { messageId, kodoLoopStage: { ...claim, stage: "code" } }),
    ).toBeUndefined();
    expect(validKodoLoopStage(loop, { messageId })).toBeUndefined();
    expect(validKodoLoopStage(undefined, { messageId, kodoLoopStage: claim })).toBeUndefined();
    expect(
      validKodoLoopStage({ ...loop, status: "stopped" }, { messageId, kodoLoopStage: claim }),
    ).toBeUndefined();
  });

  it("is dropped from every message that arrives from a transport", () => {
    const forged = {
      type: "message.dispatch",
      commandId: "c",
      threadId: "t",
      messageId,
      text: "hi",
      attachments: [],
      kodoLoopStage: claim,
      dispatchMode: { type: "start_immediately" },
    } as unknown as Parameters<typeof ThreadManagementService.withCreationProvenance>[0];
    const stamped = ThreadManagementService.withCreationProvenance(forged, {
      createdBy: "user",
      creationSource: "web",
    });
    expect(stamped).not.toHaveProperty("kodoLoopStage");
    expect(stamped).toMatchObject({ createdBy: "user", text: "hi" });
  });
});

describe("what a message arriving on the thread means for its loop", () => {
  const running = testLoop({ stage: "code", startMode: "ask" });
  const base = { threadMode: "code", steersActiveRun: false } as const;
  const person = { messageId: "m-person" };

  it("a person's message ends the loop as user_message and takes the start mode back before its run exists", () => {
    const decision = decideKodoLoopMessage({ ...base, loop: running, message: person });
    expect(decision).toMatchObject({
      type: "stop",
      setMode: "ask",
      loop: { status: "stopped", stopReason: "user_message", revision: 2 },
    });
    // The mode is handed back in the same commit; only the record of the stage that ran is owed.
    expect(decision.type === "stop" && decision.loop.cleanup).toEqual({ record: true });
  });

  it("a steer into the stage run ends the loop too, and leaves the mode to the clean-up after the run", () => {
    const decision = decideKodoLoopMessage({
      ...base,
      steersActiveRun: true,
      loop: running,
      message: person,
    });
    expect(decision).toMatchObject({
      type: "stop",
      setMode: undefined,
      loop: { stopReason: "user_message", cleanup: { leftMode: "code", record: true } },
    });
  });

  it.each([
    ["a scheduled task", { scheduledTaskId: "task" }],
    ["another agent", { senderThreadId: "other-thread" }],
    ["a goal command", {}],
  ])("%s is treated like a person", (_name, extra) => {
    expect(
      decideKodoLoopMessage({ ...base, loop: running, message: { ...person, ...extra } }),
    ).toMatchObject({ type: "stop" });
  });

  it.each([
    ["a delegated task's wake", { delegatedCompletion: {} }],
    ["a notice", { notification: {} }],
    ["idle compaction", { idleCompaction: {} }],
    ["a restart's continuation", { restartContinuationOfRunId: "r" }],
    ["a usage limit's auto-resume", { usageLimitContinuationOfRunId: "r" }],
    ["a person's resume of a run", { manualContinuationOfRunId: "r" }],
  ])("%s does not end the loop", (_name, extra) => {
    expect(
      decideKodoLoopMessage({ ...base, loop: running, message: { ...person, ...extra } }),
    ).toEqual({ type: "pass" });
  });

  it("a message on a thread with no loop, or whose loop owes nothing, is nobody's business", () => {
    expect(decideKodoLoopMessage({ ...base, loop: undefined, message: person })).toEqual({
      type: "pass",
    });
    const ended = testLoop({ status: "done", stopReason: "complete", startMode: "ask" });
    expect(decideKodoLoopMessage({ ...base, loop: ended, message: person })).toEqual({
      type: "pass",
    });
  });

  it("a message that starts its own run after a steer-stop takes the start mode, once", () => {
    const ended = testLoop({
      status: "stopped",
      stopReason: "user_message",
      startMode: "ask",
      cleanup: { leftMode: "code" },
    });
    const decision = decideKodoLoopMessage({ ...base, loop: ended, message: person });
    expect(decision).toMatchObject({ type: "restore", setMode: "ask" });
    expect(decision.type === "restore" && decision.loop.cleanup).toBeUndefined();
    // A second steer into the same run waits for the clean-up like the first.
    expect(
      decideKodoLoopMessage({ ...base, steersActiveRun: true, loop: ended, message: person }),
    ).toEqual({ type: "pass" });
    // A person who changed the mode since keeps their choice.
    expect(
      decideKodoLoopMessage({ ...base, threadMode: "review", loop: ended, message: person }),
    ).toEqual({ type: "pass" });
  });

  describe("a stage message", () => {
    const loop = testLoop({ stage: "code" });
    const id = kodoLoopStageMessageId(loop, 1, "code");
    const claim = { loopId: "L1", round: 1, stage: "code" } as const;
    const stage = { messageId: id, kodoLoopStage: claim };

    it("is accepted when the active loop is at that stage and the thread is in its mode", () => {
      expect(decideKodoLoopMessage({ ...base, loop, message: stage })).toEqual({
        type: "stage",
        stage: claim,
      });
    });

    it.each([
      ["the thread is in another mode", { threadMode: "ask" }, stage],
      ["the loop was stopped", { loop: { ...loop, status: "stopped" as const } }, stage],
      ["the loop moved to another stage", { loop: { ...loop, stage: "review" as const } }, stage],
      ["the claim names another loop", {}, { ...stage, kodoLoopStage: { ...claim, loopId: "x" } }],
      ["the loop is held", { loop: { ...loop, status: "held" as const } }, stage],
    ])("is refused when %s", (_name, over, message) => {
      const decision = decideKodoLoopMessage({ ...base, loop, ...over, message });
      expect(decision).toMatchObject({ type: "refuse" });
    });

    it("cannot be forged: a message with a loop-stage-shaped id is refused whatever it claims", () => {
      // No claim at all (the transport stripped it), and a client's own id in the reserved shape.
      for (const message of [{ messageId: id }, { messageId: "kodo-loop-L1-r1-plan" }]) {
        expect(decideKodoLoopMessage({ ...base, loop, message })).toMatchObject({
          type: "refuse",
          message: expect.stringContaining("only the running loop"),
        });
      }
      // And on a thread with no loop at all.
      expect(
        decideKodoLoopMessage({ ...base, loop: undefined, message: { messageId: id } }),
      ).toMatchObject({ type: "refuse" });
    });
  });
});

describe("mode changes while a loop runs", () => {
  const running = testLoop();

  it("are refused from anyone but the loop, with a message that says how to get out", () => {
    expect(kodoLoopModeSetRefusal(running, { commandId: "command:web:mode" })).toContain(
      "/loop stop",
    );
    expect(kodoLoopModeSetRefusal(running, { commandId: "kodo-loop:other:rev1:x:mode:1" })).toBe(
      kodoLoopModeSetRefusal(running, { commandId: "client" }),
    );
  });

  it("are the loop's own to make, and anyone's once it has ended or when there is none", () => {
    expect(
      kodoLoopModeSetRefusal(running, { commandId: "kodo-loop:L1:rev1:m:mode:1" }),
    ).toBeUndefined();
    expect(
      kodoLoopModeSetRefusal(testLoop({ status: "done" }), { commandId: "c" }),
    ).toBeUndefined();
    expect(kodoLoopModeSetRefusal(undefined, { commandId: "c" })).toBeUndefined();
  });
});

describe("a sender limited below Code", () => {
  const control = (type: KodoLoopControl["type"]) =>
    ({
      type: "thread.kodo-loop.control",
      control: type === "start" ? start : ({ type, rounds: 1 } as KodoLoopControl),
    }) as const;

  it.each(["start", "extend", "approve", "retry-judge"] as const)(
    "cannot %s a loop, whatever mode it is limited to below Code",
    (type) => {
      for (const limited of ["ask", "plan", "review"]) {
        expect(kodoLoopLimitRefusal(control(type), { interactionMode: limited })).toContain(
          `limited to ${limited} mode`,
        );
      }
    },
  );

  it("can stop one, and a sender allowed Code (or with no limit) can do all of it", () => {
    expect(kodoLoopLimitRefusal(control("stop"), { interactionMode: "plan" })).toBeUndefined();
    expect(kodoLoopLimitRefusal(control("start"), { interactionMode: "code" })).toBeUndefined();
    expect(kodoLoopLimitRefusal(control("start"), undefined)).toBeUndefined();
    expect(
      kodoLoopLimitRefusal({ type: "message.dispatch" }, { interactionMode: "ask" }),
    ).toBeUndefined();
  });
});

describe("continuing a run of a loop that ended", () => {
  const runs = [
    { id: "r1", userMessageId: "kodo-loop-L1-r1-plan" },
    { id: "r2", userMessageId: "m-restart", restartContinuationOfRunId: "r1" },
    { id: "r3", userMessageId: "m-person" },
  ];

  it.each(["user_stop", "provider_limit", "error", "round_cap"] as const)(
    "is blocked for the loop's own runs when it ended as %s, and for what continued them",
    (stopReason) => {
      const loop = testLoop({ status: "stopped", stopReason });
      expect(kodoLoopBlocksContinuation(loop, runs, { id: "r1" })).toBe(true);
      expect(kodoLoopBlocksContinuation(loop, runs, { id: "r2" })).toBe(true);
      expect(kodoLoopBlocksContinuation(loop, runs, { id: "r3" })).toBe(false);
    },
  );

  it("is allowed after a person's message took the run over, while the loop runs, or with no loop", () => {
    const taken = testLoop({ status: "stopped", stopReason: "user_message" });
    expect(kodoLoopBlocksContinuation(taken, runs, { id: "r1" })).toBe(false);
    expect(kodoLoopBlocksContinuation(testLoop(), runs, { id: "r1" })).toBe(false);
    expect(kodoLoopBlocksContinuation(undefined, runs, { id: "r1" })).toBe(false);
  });
});

describe("who may start a loop", () => {
  it.each([
    [
      "a request from a thread running a loop, whoever sent it",
      "user",
      undefined,
      true,
      "cannot start another loop",
    ],
    [
      "an agent over a loop a person stopped",
      "agent",
      { status: "stopped", stopReason: "user_stop" },
      false,
      "a person stopped it",
    ],
    [
      "an agent over a loop a person's message ended",
      "agent",
      { status: "stopped", stopReason: "user_message" },
      false,
      "sent a message",
    ],
    [
      "an agent over a loop the budget stopped",
      "agent",
      { status: "stopped", stopReason: "budget" },
      false,
      "reached its budget",
    ],
  ] as const)("refuses %s", (_name, requestedBy, target, callerRunsLoop, text) => {
    expect(kodoLoopStartRefusal({ requestedBy, target, callerRunsLoop })).toContain(text);
  });

  it.each([
    ["a person over any ended loop", "user", { status: "stopped", stopReason: "budget" }],
    ["an agent over a loop that finished", "agent", { status: "done", stopReason: "complete" }],
    ["an agent over a loop that failed", "agent", { status: "failed", stopReason: "error" }],
    [
      "an agent over a loop that hit its round cap",
      "agent",
      { status: "stopped", stopReason: "round_cap" },
    ],
    ["an agent on a thread with no loop", "agent", undefined],
  ] as const)("allows %s", (_name, requestedBy, target) => {
    expect(kodoLoopStartRefusal({ requestedBy, target, callerRunsLoop: false })).toBeUndefined();
  });

  it("leaves a running loop to the ordinary 'already running' refusal", () => {
    expect(
      kodoLoopStartRefusal({
        requestedBy: "agent",
        target: { status: "active" },
        callerRunsLoop: false,
      }),
    ).toBeUndefined();
  });
});
