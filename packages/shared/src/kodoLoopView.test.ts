import { describe, expect, it } from "@effect/vitest";
import { MessageId, RunId, type KodoLoop, type KodoLoopStageRecord } from "@t3tools/contracts";

import {
  formatKodoTokens,
  formatKodoUsd,
  kodoLoopBanner,
  kodoLoopSavingsHeadline,
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
    // 700 each: cache reads (300 each) are shown apart and are not what the cap counts.
    expect(summary.tokens).toBe(1_400);
    expect(summary.cacheReadTokens).toBe(600);
    expect(summary.costUsd).toBe(0.5);
    expect(summary.unpricedStages).toEqual(["round 1 code"]);
    expect(summary.unreportedStages).toEqual(["round 1 review"]);
    expect(summary.byModel).toEqual([
      { model: "cheap", tokens: 700, sharePct: 50 },
      { model: "other", tokens: 700, sharePct: 50 },
    ]);
    // A stage reported nothing and one has no price: both totals are floors.
    expect(summary.totalsLine).toBe("At least 1,400 tokens, at least $0.50 at API prices.");
  });

  it("has no token or cost totals when no provider reported", () => {
    const summary = summarizeKodoLoop(loop({ stages: [record({ round: 1, stage: "plan" })] }));
    expect(summary.tokens).toBeNull();
    expect(summary.costUsd).toBeNull();
    expect(summary.byModel).toEqual([]);
    expect(summary.totalsLine).toBe("Token usage was not reported by the provider.");
  });

  it("says when usage was only partly reported", () => {
    const summary = summarizeKodoLoop(
      loop({ stages: [record({ round: 1, stage: "plan", usage: usage({ complete: false }) })] }),
    );
    expect(summary.partial).toBe(true);
    expect(summary.totalsLine).toMatch(/^At least /);
  });

  it("reads exact when every stage reported and was priced", () => {
    const summary = summarizeKodoLoop(
      loop({ stages: [record({ round: 1, stage: "plan", usage: usage({ costUsd: 0.25 }) })] }),
    );
    expect(summary.totalsLine).toBe("700 tokens, $0.25 at API prices.");
  });

  it("counts subagent and compaction tokens, and says their cost is not in the price", () => {
    const summary = summarizeKodoLoop(
      loop({
        stages: [
          record({ round: 1, stage: "code", usage: usage({ costUsd: 1, otherTokens: 5_000 }) }),
        ],
      }),
    );
    expect(summary.tokens).toBe(5_700);
    expect(summary.totalsLine).toBe("5,700 tokens, at least $1.00 at API prices.");
    expect(summary.usageNotes).toEqual([
      "Includes 5,000 tokens of subagent or compaction work, which have no price.",
    ]);
  });

  it("reads 'At least' while the stage the loop ended in is not recorded yet", () => {
    const summary = summarizeKodoLoop(
      loop({
        status: "stopped",
        stopReason: "user_stop",
        round: 1,
        stage: "code",
        cleanup: { record: true },
        stages: [record({ round: 1, stage: "plan", usage: usage({ costUsd: 0.5 }) })],
      }),
    );
    expect(summary.pendingStage).toBe("round 1 code");
    expect(summary.totalsLine).toBe("At least 700 tokens, at least $0.50 at API prices.");
    expect(summary.usageNotes[0]).toContain("Round 1 code was running when the loop ended");
  });

  it("shows an interrupted stage as such, with its usage counted", () => {
    const interrupted = record({
      round: 1,
      stage: "code",
      status: "interrupted",
      usage: usage({ costUsd: 2 }),
    });
    expect(kodoLoopStageLine(interrupted)).toBe(
      "Interrupted: the loop ended while this stage was running.",
    );
    const summary = summarizeKodoLoop(
      loop({ status: "stopped", stopReason: "user_stop", stages: [interrupted] }),
    );
    expect(summary.pendingStage).toBeNull();
    expect(summary.totalsLine).toBe("700 tokens, $2.00 at API prices.");
  });

  it("says what each budget could not count, and when the limit could not be seen", () => {
    const summary = summarizeKodoLoop(
      loop({
        budget: { maxCostUsd: 1, maxTokens: 100 },
        limitCheck: {
          state: "stale",
          provider: "Claude",
          unchecked: [
            { round: 1, stage: "plan" as const },
            { round: 1, stage: "code" as const },
          ],
        },
        stages: [
          record({ round: 1, stage: "plan", usage: usage() }),
          record({ round: 1, stage: "code" }),
        ],
      }),
    );
    expect(summary.budgetNotes).toEqual([
      "The cost cap counted only stages with a price. It could not count round 1 plan.",
      "The token cap could not count round 1 code: the provider reported no usage.",
      "No recent usage-limit reading was available for Claude, so the limit setting could not stop this loop before 2 stages.",
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

  it("words a negative estimate as extra cost, never as savings", () => {
    const view = (savedUsd: number, savedPct: number) =>
      kodoLoopSavingsHeadline({
        kind: "estimate",
        referenceModel: "big",
        actualUsd: 2,
        referenceUsd: 1,
        savedUsd,
        savedPct,
        pricedStages: 1,
        unpricedStages: [],
      });
    expect(view(9, 90)).toBe("Saved about $9.00 (90%) against big (estimate)");
    expect(kodoLoopSavingsHeadline({ kind: "same-model", referenceModel: "big" })).toBe(
      "Nothing to compare: Code ran on big, the model used as the reference.",
    );
    expect(kodoLoopSavingsHeadline({ kind: "none" })).toBeNull();
    expect(view(-1, -100)).toBe("Cost $1.00 more than big would have (100%, estimate)");
  });

  it("names every model a stage ran on rather than the first", () => {
    const summary = summarizeKodoLoop(
      loop({
        stages: [record({ round: 1, stage: "code", usage: usage({ models: ["a", "b"] }) })],
      }),
    );
    expect(summary.byModel.map((entry) => entry.model)).toEqual(["a + b"]);
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
