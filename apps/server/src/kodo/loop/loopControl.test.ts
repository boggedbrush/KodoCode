import { describe, expect, it } from "@effect/vitest";
import { CheckpointId, MessageId, type KodoLoopControl } from "@t3tools/contracts";

import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import { decideKodoLoopAdvance, decideKodoLoopControl, validKodoLoopStage } from "./loopControl.ts";
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
        baseline: { runOrdinal: 3, checkpointTurnCount: 2 },
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
    baseline: { runOrdinal: 4 },
  });

  it("moves the baseline past whatever a person ran in the meantime", () => {
    const result = decideKodoLoopControl({
      commandId: "c",
      control: { type: "extend", rounds: 2 },
      thread: thread({ interactionMode: "code", kodoLoop: capped }),
      runs: [run("completed", 9)],
    });
    expect(result).toMatchObject({
      ok: true,
      loop: { round: 2, maxRounds: 5, baseline: { runOrdinal: 9 } },
    });
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
