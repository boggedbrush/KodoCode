import { describe, expect, it } from "@effect/vitest";
import { MessageId, RunId, type KodoLoop, type KodoLoopStageRecord } from "@t3tools/contracts";

import {
  formatKodoTokens,
  formatKodoUsd,
  kodoLoopBanner,
  kodoLoopStageLine,
  summarizeKodoLoop,
} from "./kodoLoopView.ts";

const record = (
  over: Partial<KodoLoopStageRecord> & Pick<KodoLoopStageRecord, "round" | "stage">,
): KodoLoopStageRecord => ({
  messageId: MessageId.make(`m-${over.round}-${over.stage}`),
  runId: RunId.make(`r-${over.round}-${over.stage}`),
  status: "completed",
  model: { instanceId: "i" as never, model: "cheap" },
  startedAt: "2026-01-01T00:00:00.000Z",
  completedAt: "2026-01-01T00:01:00.000Z",
  ...over,
});

const usage = (over: Record<string, unknown> = {}) => ({
  uncachedInputTokens: 600,
  cachedInputTokens: 300,
  cacheCreationTokens: 0,
  outputTokens: 100,
  reasoningTokens: 0,
  complete: true,
  ...over,
});

const loop = (over: Partial<KodoLoop> = {}): KodoLoop => ({
  loopId: "L",
  revision: 9,
  status: "done",
  stopReason: "complete",
  round: 2,
  maxRounds: 3,
  stage: "judge",
  request: "Do it.",
  requestMessageId: MessageId.make("req"),
  startMode: "code",
  planApproval: "auto",
  budget: {},
  baseline: {},
  stages: [],
  ...over,
});

describe("the mobile banner", () => {
  const status = (over: Partial<Parameters<typeof kodoLoopBanner>[0]> = {}) => ({
    status: "active" as const,
    round: 2,
    maxRounds: 3,
    stage: "review" as const,
    ...over,
  });

  it("reads 'Loop · Round 2 of 3 · Review' with Stop while it runs", () => {
    expect(kodoLoopBanner(status(), { canOperate: true })).toEqual({
      title: "Loop · Round 2 of 3 · Review",
      detail: null,
      tone: "running",
      stop: true,
      approve: false,
    });
  });

  it("offers Approve plan only when held for approval, and only to someone who may operate", () => {
    const held = status({ status: "held", hold: "plan_approval", stage: "code" });
    expect(kodoLoopBanner(held, { canOperate: true })).toMatchObject({
      title: "Loop · Round 2 of 3 · Code · Plan ready",
      approve: true,
      stop: true,
      tone: "held",
    });
    expect(kodoLoopBanner(held, { canOperate: false })).toMatchObject({
      approve: false,
      stop: false,
    });
  });

  it("ends with the stop reason and no actions", () => {
    const stopped = status({
      status: "stopped",
      stopReason: "budget",
      stopDetail: "Claude 5-hour window at 92%, limit 90%.",
    });
    expect(kodoLoopBanner(stopped, { canOperate: true })).toEqual({
      title: "Loop stopped · Round 2 of 3 · Review",
      detail: "Claude 5-hour window at 92%, limit 90%.",
      tone: "stopped",
      stop: false,
      approve: false,
    });
    expect(
      kodoLoopBanner(status({ status: "done", stopReason: "complete" }), { canOperate: true }),
    ).toMatchObject({ title: "Loop complete after 2 rounds", detail: null });
  });
});

describe("stage lines", () => {
  it.each([
    [
      record({ round: 1, stage: "plan", conclusion: "Guard inverted limits" }),
      "Guard inverted limits",
    ],
    [record({ round: 1, stage: "plan", status: "failed" }), "No plan was produced."],
    [record({ round: 1, stage: "code" }), "Coding finished."],
    [
      record({
        round: 1,
        stage: "review",
        review: { parsed: true, verdict: "concerns", findings: 3, high: 1 },
        conclusion: "Mostly fine.",
      }),
      "Concerns: 3 findings, 1 high. Mostly fine.",
    ],
    [
      record({
        round: 1,
        stage: "review",
        review: { parsed: true, verdict: "pass", findings: 0, high: 0 },
      }),
      "Pass: no findings.",
    ],
    [
      record({ round: 1, stage: "review", review: { parsed: false, findings: 0, high: 0 } }),
      "The review's structured result could not be read; the Judge read its text.",
    ],
    [
      record({
        round: 1,
        stage: "judge",
        verdict: { complete: false, outstandingCount: 2, outstanding: [] },
        conclusion: "Needs a test.",
      }),
      "2 outstanding. Needs a test.",
    ],
    [
      record({
        round: 1,
        stage: "judge",
        verdict: { complete: true, outstandingCount: 0, outstanding: [] },
      }),
      "Complete.",
    ],
  ])("%#", (entry, line) => {
    expect(kodoLoopStageLine(entry)).toBe(line);
  });
});

describe("formatting", () => {
  it.each([
    [999, "999"],
    [12_345, "12.3k"],
    [250_000, "250k"],
    [4_500_000, "4.5M"],
  ])("tokens %d", (count, text) => expect(formatKodoTokens(count)).toBe(text));

  it("dollars never show a tiny real amount as free", () => {
    expect(formatKodoUsd(0)).toBe("$0.00");
    expect(formatKodoUsd(0.001)).toBe("<$0.01");
    expect(formatKodoUsd(1.234)).toBe("$1.23");
  });
});

describe("the loop summary", () => {
  it("groups the stages into rounds with a line each, and reports the stop and the rounds run", () => {
    const summary = summarizeKodoLoop(
      loop({
        stages: [
          record({ round: 1, stage: "plan", conclusion: "Plan A" }),
          record({ round: 1, stage: "code" }),
          record({ round: 2, stage: "plan", conclusion: "Plan B" }),
        ],
      }),
    );
    expect(summary.roundsRun).toBe(2);
    expect(summary.rounds.map((round) => round.stages.map((entry) => entry.stage))).toEqual([
      ["plan", "code"],
      ["plan"],
    ]);
    expect(summary.stopText).toBe("The Judge found the request complete.");
  });

  it("totals what was reported, shares tokens by the model that ran, and never turns a missing number into zero", () => {
    const summary = summarizeKodoLoop(
      loop({
        stages: [
          record({ round: 1, stage: "plan", usage: usage({ costUsd: 0.5 }) }),
          record({ round: 1, stage: "code", usage: usage({ models: ["other"] }) }),
          record({ round: 1, stage: "review" }),
        ],
      }),
    );
    expect(summary.tokens).toBe(2_000);
    expect(summary.costUsd).toBe(0.5);
    expect(summary.unpricedStages).toEqual(["round 1 code"]);
    expect(summary.unreportedStages).toEqual(["round 1 review"]);
    expect(summary.byModel).toEqual([
      { model: "cheap", tokens: 1_000, sharePct: 50 },
      { model: "other", tokens: 1_000, sharePct: 50 },
    ]);
  });

  it("has no token or cost totals when no provider reported", () => {
    const summary = summarizeKodoLoop(loop({ stages: [record({ round: 1, stage: "plan" })] }));
    expect(summary.tokens).toBeNull();
    expect(summary.costUsd).toBeNull();
    expect(summary.byModel).toEqual([]);
  });

  it("says when usage was only partly reported", () => {
    const summary = summarizeKodoLoop(
      loop({ stages: [record({ round: 1, stage: "plan", usage: usage({ complete: false }) })] }),
    );
    expect(summary.partial).toBe(true);
  });

  it("says what each budget could not count, and when the limit could not be seen", () => {
    const summary = summarizeKodoLoop(
      loop({
        budget: { maxCostUsd: 1, maxTokens: 100 },
        limitCheck: { state: "stale", provider: "Claude" },
        stages: [
          record({ round: 1, stage: "plan", usage: usage() }),
          record({ round: 1, stage: "code" }),
        ],
      }),
    );
    expect(summary.budgetNotes).toEqual([
      "The cost cap counted only stages with a price. It could not count round 1 plan.",
      "The token cap could not count round 1 code: the provider reported no usage.",
      "Claude's usage-limit reading was out of date, so the limit setting could not stop this loop.",
    ]);
  });

  const savings = {
    actualUsd: 1,
    referenceUsd: 10,
    savedUsd: 9,
    savedPct: 90,
    referenceModel: { instanceId: "i" as never, model: "big" },
    pricedStages: 1,
    unpricedStages: [],
    sameModelStages: 0,
  };

  it.each([
    ["an estimate when stages were priced", { savings }, "estimate"],
    [
      "no comparison when Code ran on the reference",
      { savings: { ...savings, pricedStages: 0, sameModelStages: 1 } },
      "same-model",
    ],
    [
      "unavailable pricing when nothing could be priced",
      {
        savings: {
          ...savings,
          pricedStages: 0,
          unpricedStages: [{ round: 1, stage: "code" as const }],
        },
      },
      "unpriced",
    ],
    [
      "no reference when Code ran but no estimate exists",
      { stages: [record({ round: 1, stage: "code" })] },
      "no-reference",
    ],
    ["nothing before Code ran", {}, "none"],
  ] as const)("savings: %s", (_name, over, kind) => {
    expect(summarizeKodoLoop(loop(over as Partial<KodoLoop>)).savings.kind).toBe(kind);
  });

  it("lists the limit readings seen around each stage", () => {
    const summary = summarizeKodoLoop(
      loop({
        stages: [
          record({
            round: 1,
            stage: "code",
            limits: [{ window: "5-hour", before: 40, after: 44 }],
          }),
        ],
      }),
    );
    expect(summary.limitChanges).toEqual([
      { stage: "round 1 code", windows: [{ window: "5-hour", before: 40, after: 44 }] },
    ]);
  });
});
