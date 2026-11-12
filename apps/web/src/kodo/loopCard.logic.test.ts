import { describe, expect, it } from "@effect/vitest";
import { MessageId, type KodoLoop } from "@t3tools/contracts";

import {
  kodoLoopActions,
  kodoLoopHeldReason,
  kodoLoopOutstanding,
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

describe("what a loop that ended without finishing says is outstanding", () => {
  const judged = (verdict: NonNullable<KodoLoop["stages"][number]["verdict"]>, round = 1) => ({
    round,
    stage: "judge" as const,
    messageId: MessageId.make(`j${round}`),
    runId: null,
    status: "completed" as const,
    model: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    conclusion: "One thing is missing in `parse()`.",
    verdict,
  });
  const incomplete = {
    complete: false,
    outstandingCount: 3,
    outstanding: [{ title: "No test for `strict`" }, { title: "Docs" }],
  };

  it.each([
    ["the round cap", { status: "stopped", stopReason: "round_cap" }],
    ["a stop", { status: "stopped", stopReason: "user_stop" }],
    ["an error", { status: "failed", stopReason: "error" }],
  ] as const)(
    "is listed when the loop ended at %s, with the titles and how many more",
    (_name, ended) => {
      const result = kodoLoopOutstanding(loop({ ...ended, stages: [judged(incomplete)] }));
      expect(result).toEqual({
        summary: "One thing is missing in `parse()`.",
        items: ["No test for `strict`", "Docs"],
        more: 1,
      });
    },
  );

  it("is the newest judged round's, even when the loop stopped in a later round", () => {
    const result = kodoLoopOutstanding(
      loop({
        status: "stopped",
        stopReason: "user_stop",
        stages: [
          judged({ ...incomplete, outstandingCount: 2 }, 1),
          judged(
            { complete: false, outstandingCount: 1, outstanding: [{ title: "Only this" }] },
            2,
          ),
        ],
      }),
    );
    expect(result?.items).toEqual(["Only this"]);
  });

  it.each([
    ["it runs", { status: "active" }, incomplete],
    [
      "it is done",
      { status: "done", stopReason: "complete" },
      { complete: true, outstandingCount: 0, outstanding: [] },
    ],
    ["no round was judged", { status: "stopped", stopReason: "user_stop" }, undefined],
  ] as const)("is not shown when %s", (_name, over, verdict) => {
    expect(
      kodoLoopOutstanding(
        loop({ ...over, stages: verdict === undefined ? [] : [judged(verdict)] }),
      ),
    ).toBeNull();
  });
});
