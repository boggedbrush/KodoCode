import { describe, expect, it } from "@effect/vitest";
import { MessageId, type KodoLoop } from "@t3tools/contracts";

import {
  kodoLoopActions,
  kodoLoopHeldReason,
  kodoLoopStageStrip,
  kodoLoopStopText,
  kodoLoopTitle,
} from "./loopCard.logic";

const loop = (over: Partial<KodoLoop> = {}): KodoLoop => ({
  loopId: "L1",
  revision: 3,
  status: "active",
  round: 2,
  maxRounds: 3,
  stage: "review",
  request: "Do it.",
  requestMessageId: MessageId.make("m"),
  startMode: "code",
  planApproval: "auto",
  budget: {},
  baseline: {},
  stages: [
    {
      round: 2,
      stage: "plan",
      messageId: MessageId.make("p"),
      runId: null,
      status: "completed",
      model: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
    },
    {
      round: 2,
      stage: "code",
      messageId: MessageId.make("c"),
      runId: null,
      status: "completed",
      model: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
    },
    {
      round: 1,
      stage: "review",
      messageId: MessageId.make("r1"),
      runId: null,
      status: "completed",
      model: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
    },
  ],
  ...over,
});

describe("the loop card", () => {
  it("names the round and stage", () => {
    expect(kodoLoopTitle(loop())).toBe("Round 2 of 3 · Review");
    expect(kodoLoopTitle(loop({ status: "held", hold: "plan_approval", stage: "code" }))).toBe(
      "Round 2 of 3 · Code · Plan ready",
    );
    expect(kodoLoopTitle(loop({ status: "done", stopReason: "complete" }))).toBe(
      "Loop complete after 2 rounds",
    );
  });

  it("marks this round's finished stages, the current one and what is left", () => {
    expect(kodoLoopStageStrip(loop()).map((entry) => entry.state)).toEqual([
      "done",
      "done",
      "current",
      "upcoming",
    ]);
    expect(
      kodoLoopStageStrip(loop({ status: "failed", stopReason: "error", stage: "judge" })).map(
        (entry) => entry.state,
      ),
    ).toEqual(["done", "done", "upcoming", "stopped"]);
    expect(
      kodoLoopStageStrip(loop({ status: "done", stopReason: "complete" })).every(
        (e) => e.state === "done",
      ),
    ).toBe(true);
  });

  it("explains a hold and a stop", () => {
    expect(kodoLoopHeldReason(loop())).toBeNull();
    expect(kodoLoopHeldReason(loop({ status: "held", hold: "runtime_request" }))).toContain(
      "request",
    );
    expect(kodoLoopStopText(loop())).toBeNull();
    expect(kodoLoopStopText(loop({ status: "stopped", stopReason: "round_cap" }))).toContain(
      "3 rounds",
    );
    expect(kodoLoopStopText(loop({ status: "failed", stopReason: "verdict_invalid" }))).toContain(
      "could not be read",
    );
  });
});

describe("what the person can do", () => {
  const input = { canOperate: true, threadIdle: true, extendRounds: 3 };

  it("stops a running loop, and approves a held plan", () => {
    expect(kodoLoopActions(loop(), input)).toMatchObject({ stop: true, approve: false });
    expect(kodoLoopActions(loop({ status: "held", hold: "plan_approval" }), input)).toMatchObject({
      stop: true,
      approve: true,
    });
  });

  it("offers a retry of the judge only for an unreadable verdict, and more rounds only at the cap", () => {
    const unreadable = loop({ status: "failed", stopReason: "verdict_invalid", stage: "judge" });
    expect(kodoLoopActions(unreadable, input)).toMatchObject({ retryJudge: true, extendBy: 0 });
    const capped = loop({ status: "stopped", stopReason: "round_cap", stage: "judge" });
    expect(kodoLoopActions(capped, input)).toMatchObject({ retryJudge: false, extendBy: 3 });
    expect(kodoLoopActions({ ...capped, maxRounds: 15 }, input).extendBy).toBe(1);
    expect(kodoLoopActions({ ...capped, maxRounds: 16 }, input).extendBy).toBe(0);
  });

  it("offers nothing without permission, nor to resume while a turn runs", () => {
    const capped = loop({ status: "stopped", stopReason: "round_cap", stage: "judge" });
    expect(kodoLoopActions(loop(), { ...input, canOperate: false })).toEqual({
      stop: false,
      approve: false,
      retryJudge: false,
      extendBy: 0,
    });
    expect(kodoLoopActions(capped, { ...input, threadIdle: false }).extendBy).toBe(0);
  });
});
