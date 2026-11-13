import { describe, expect, it } from "@effect/vitest";
import type { KodoLoopStageRecord, ModelSelection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  computeLoopSavings,
  loopTotals,
  priceStageUsage,
  repriceStageRecord,
  type PriceTokens,
} from "./loopSpend.ts";
import { summarizeStageUsage, type StageTokenTotals } from "./stageUsage.ts";
import { testRecord } from "./testing.ts";

const instanceId = "claude-main" as ModelSelection["instanceId"];
const select = (model: string): ModelSelection => ({ instanceId, model });
const reference = select("big");

/** A price list in dollars per million tokens of everything, so the arithmetic is easy to follow. */
const RATES: Record<string, number> = { big: 10, small: 1, cheap: 0.5 };
const price: PriceTokens = (model, totals: StageTokenTotals) =>
  Effect.succeed(
    RATES[model] === undefined
      ? null
      : ((totals.uncachedInputTokens +
          totals.cachedInputTokens +
          totals.cacheCreationTokens +
          totals.outputTokens) *
          RATES[model]!) /
          1_000_000,
  );

const tokens = (
  over: Partial<StageTokenTotals> & { otherTokens?: number; models?: ReadonlyArray<string> } = {},
) => ({
  uncachedInputTokens: 600_000,
  cachedInputTokens: 300_000,
  cacheCreationTokens: 0,
  outputTokens: 100_000,
  reasoningTokens: 0,
  complete: true,
  ...over,
});

const stage = (
  round: number,
  name: KodoLoopStageRecord["stage"],
  model: string,
  usage: KodoLoopStageRecord["usage"] | undefined,
) =>
  testRecord({
    round,
    stage: name,
    model: select(model),
    ...(usage === undefined ? {} : { usage }),
  });

describe("pricing a stage", () => {
  const turn = (model: string, input: number) => ({
    turnTokenUsage: {
      usageScope: "main_agent" as const,
      usageStatus: "complete" as const,
      hasSubagents: false,
      inputTokens: input,
      outputTokens: 0,
      models: [model],
    },
  });

  it.effect("prices each model's tokens at its own rate, and the whole at the reference's", () =>
    Effect.gen(function* () {
      const summary = summarizeStageUsage(
        [turn("small", 1_000_000), turn("cheap", 2_000_000)],
        "small",
      )!;
      const usage = yield* priceStageUsage(summary, { reference, price });
      expect(usage.costUsd).toBeCloseTo(1 + 1, 6);
      expect(usage.referenceCostUsd).toBeCloseTo(30, 6);
    }),
  );

  it.effect("has no cost, never zero, when a model on the stage has no price", () =>
    Effect.gen(function* () {
      const summary = summarizeStageUsage([turn("small", 1_000_000), turn("local", 10)], "small")!;
      const usage = yield* priceStageUsage(summary, { reference, price });
      expect(usage.costUsd).toBeUndefined();
      expect(usage.referenceCostUsd).toBeDefined();
    }),
  );

  it.effect(
    "has no reference cost without a reference model or when the reference is unpriced",
    () =>
      Effect.gen(function* () {
        const summary = summarizeStageUsage([turn("small", 1_000_000)], "small")!;
        expect(
          (yield* priceStageUsage(summary, { reference: null, price })).referenceCostUsd,
        ).toBeUndefined();
        expect(
          (yield* priceStageUsage(summary, { reference: select("unlisted"), price }))
            .referenceCostUsd,
        ).toBeUndefined();
      }),
  );
});

describe("pricing a settled stage again", () => {
  it.effect("prices a stage that had no price once its model has one, and leaves the rest alone", () =>
    Effect.gen(function* () {
      const record = stage(1, "code", "small", tokens({ models: ["small"] }));
      const priced = yield* repriceStageRecord(record, { reference, price });
      expect(priced?.usage?.costUsd).toBeCloseTo(1, 6);
      expect(priced?.usage?.referenceCostUsd).toBeCloseTo(10, 6);
      expect(priced?.usage?.models).toEqual(["small"]);
      // Already priced, still unpriced, or run on several models: nothing to change.
      expect(yield* repriceStageRecord(priced!, { reference, price })).toBeUndefined();
      expect(
        yield* repriceStageRecord(stage(1, "code", "local", tokens()), { reference, price }),
      ).toBeUndefined();
      expect(
        yield* repriceStageRecord(stage(1, "code", "small", tokens({ models: ["a", "b"] })), {
          reference,
          price,
        }),
      ).toBeUndefined();
      expect(yield* repriceStageRecord(stage(1, "review", "small", undefined), { reference, price })).toBeUndefined();
    }),
  );
});

describe("loop totals", () => {
  it("counts tokens of the stages that reported, prices only those with a price, and lists the rest", () => {
    const totals = loopTotals([
      stage(1, "plan", "small", tokens({ costUsd: 2 } as never)),
      stage(1, "code", "local", tokens()),
      stage(1, "review", "big", undefined),
    ]);
    // The cap counts uncached input, cache writes and output; cache reads (300k per stage) are left out.
    expect(totals.tokens).toBe(1_400_000);
    expect(totals.costUsd).toBe(2);
    expect(totals.pricedStages).toBe(1);
    expect(totals.unpricedStages.map((record) => record.stage)).toEqual(["code"]);
    expect(totals.unreportedStages.map((record) => record.stage)).toEqual(["review"]);
  });

  it("counts the subagent and compaction tokens a provider reported", () => {
    const totals = loopTotals([stage(1, "code", "small", tokens({ otherTokens: 250_000 }))]);
    expect(totals.tokens).toBe(700_000 + 250_000);
  });

  it("has no cost when nothing has a price", () => {
    expect(loopTotals([stage(1, "code", "local", tokens())]).costUsd).toBeNull();
    expect(loopTotals([]).costUsd).toBeNull();
  });
});

describe("estimated savings", () => {
  const priced = (model: string, over: Partial<StageTokenTotals> = {}) => {
    const usage = tokens(over);
    const count =
      usage.uncachedInputTokens +
      usage.cachedInputTokens +
      usage.cacheCreationTokens +
      usage.outputTokens;
    return {
      ...usage,
      costUsd: (count * RATES[model]!) / 1e6,
      referenceCostUsd: (count * RATES["big"]!) / 1e6,
    };
  };

  it("is the same tokens at the reference's rates minus what they cost, for Code and a different-model Plan", () => {
    const savings = computeLoopSavings(
      [
        stage(1, "plan", "small", priced("small")),
        stage(1, "code", "cheap", priced("cheap")),
        stage(1, "review", "big", priced("big")),
        stage(1, "judge", "big", priced("big")),
      ],
      reference,
    );
    // Plan and Code each used 1M tokens: 10 each at the reference, 1 and 0.5 where they ran.
    expect(savings).toMatchObject({
      referenceUsd: 20,
      actualUsd: 1.5,
      pricedStages: 2,
      sameModelStages: 0,
      unpricedStages: [],
      referenceModel: reference,
    });
    expect(savings?.savedUsd).toBeCloseTo(18.5, 6);
    expect(savings?.savedPct).toBeCloseTo(92.5, 6);
  });

  it("counts cache tokens as the tokens they are, at the one rate the price call gives them", () => {
    const savings = computeLoopSavings(
      [
        stage(
          1,
          "code",
          "small",
          priced("small", { cachedInputTokens: 900_000, uncachedInputTokens: 0 }),
        ),
      ],
      reference,
    );
    expect(savings?.pricedStages).toBe(1);
    expect(savings?.savedUsd).toBeCloseTo(9, 6);
  });

  it("lists a stage that has no price or reported nothing, and never counts it as free", () => {
    const savings = computeLoopSavings(
      [
        stage(1, "plan", "small", priced("small")),
        stage(1, "code", "local", tokens()),
        stage(2, "code", "small", undefined),
      ],
      reference,
    );
    expect(savings).toMatchObject({
      pricedStages: 1,
      unpricedStages: [
        { round: 1, stage: "code" },
        { round: 2, stage: "code" },
      ],
    });
    expect(savings?.actualUsd).toBeCloseTo(1, 6);
    expect(savings?.referenceUsd).toBeCloseTo(10, 6);
  });

  it("is a lower or even negative saving when the cheaper model cost more", () => {
    const savings = computeLoopSavings(
      [stage(1, "code", "small", { ...tokens(), costUsd: 20, referenceCostUsd: 10 })],
      reference,
    );
    expect(savings?.savedUsd).toBe(-10);
    expect(savings?.savedPct).toBe(-100);
  });

  it("has nothing to compare when Code ran on the reference model, and says how many stages", () => {
    const savings = computeLoopSavings([stage(1, "code", "big", priced("big"))], reference);
    expect(savings).toMatchObject({ pricedStages: 0, sameModelStages: 1, unpricedStages: [] });
    expect(savings?.savedUsd).toBe(0);
  });

  it("does not count a Plan on the reference model as a grunt stage", () => {
    const savings = computeLoopSavings(
      [stage(1, "plan", "big", priced("big")), stage(1, "code", "small", priced("small"))],
      reference,
    );
    expect(savings?.pricedStages).toBe(1);
    expect(savings?.sameModelStages).toBe(0);
  });

  it("is absent without a reference model, and before any Code or Plan stage ran", () => {
    expect(computeLoopSavings([stage(1, "code", "small", priced("small"))], null)).toBeUndefined();
    expect(
      computeLoopSavings([stage(1, "review", "big", priced("big"))], reference),
    ).toBeUndefined();
    expect(computeLoopSavings([], reference)).toBeUndefined();
  });

  it("compares the configured model, so a dated id the provider reported cannot hide a same-model stage", () => {
    const savings = computeLoopSavings(
      [stage(1, "code", "big", { ...priced("big"), models: ["big-20261001"] })],
      reference,
    );
    expect(savings).toMatchObject({ pricedStages: 0, sameModelStages: 1, unpricedStages: [] });
  });

  it("does not take a stage run on another provider for the reference model because the ids match", () => {
    const elsewhere = { instanceId: "other" as ModelSelection["instanceId"], model: "big" };
    const savings = computeLoopSavings(
      [
        testRecord({
          round: 1,
          stage: "code",
          model: elsewhere,
          usage: priced("small"),
        }),
      ],
      reference,
    );
    expect(savings?.pricedStages).toBe(1);
    expect(savings?.sameModelStages).toBe(0);
  });
});
