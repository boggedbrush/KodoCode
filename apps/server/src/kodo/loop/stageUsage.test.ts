import { describe, expect, it } from "@effect/vitest";
import type { OrchestrationV2ProviderTurn } from "@t3tools/contracts";

import { summarizeStageUsage } from "./stageUsage.ts";

type Turn = Pick<OrchestrationV2ProviderTurn, "turnTokenUsage" | "model">;

const complete = (over: Record<string, unknown> = {}): Turn["turnTokenUsage"] =>
  ({
    usageScope: "main_agent",
    usageStatus: "complete",
    hasSubagents: false,
    inputTokens: 1_000,
    outputTokens: 200,
    ...over,
  }) as Turn["turnTokenUsage"];

const turn = (usage: Turn["turnTokenUsage"], model?: string): Turn => ({
  turnTokenUsage: usage,
  ...(model === undefined ? {} : { model }),
});

describe("a stage's usage from its provider turns", () => {
  it("is unavailable, not zero, when no turn reported anything", () => {
    expect(summarizeStageUsage([], "base")).toBeUndefined();
    expect(summarizeStageUsage([turn(undefined)], "base")).toBeUndefined();
    expect(
      summarizeStageUsage(
        [turn({ usageScope: "main_agent", usageStatus: "unavailable", hasSubagents: false })],
        "base",
      ),
    ).toBeUndefined();
  });

  it("splits input into uncached, cached and cache writes, and keeps reasoning as part of output", () => {
    const summary = summarizeStageUsage(
      [
        turn(
          complete({
            inputTokens: 1_000,
            cachedInputTokens: 600,
            cacheCreationTokens: 100,
            outputTokens: 200,
            reasoningTokens: 50,
          }),
        ),
      ],
      "base",
    );
    expect(summary?.usage).toEqual({
      uncachedInputTokens: 300,
      cachedInputTokens: 600,
      cacheCreationTokens: 100,
      outputTokens: 200,
      reasoningTokens: 50,
      complete: true,
    });
  });

  it("clamps cache counters that exceed their parent, so uncached input is never negative", () => {
    const summary = summarizeStageUsage(
      [turn(complete({ inputTokens: 100, cachedInputTokens: 500, cacheCreationTokens: 500 }))],
      "base",
    );
    expect(summary?.usage).toMatchObject({
      uncachedInputTokens: 0,
      cachedInputTokens: 100,
      cacheCreationTokens: 0,
    });
  });

  it("sums every attempt of a run, and names the model each ran on", () => {
    const summary = summarizeStageUsage(
      [
        turn(complete({ inputTokens: 100, outputTokens: 10 }), "model-a"),
        turn(complete({ inputTokens: 300, outputTokens: 30, models: ["model-b"] })),
        turn(complete({ inputTokens: 50, outputTokens: 5 }), "model-a"),
      ],
      "asked-for",
    );
    expect(summary?.usage).toMatchObject({
      uncachedInputTokens: 450,
      outputTokens: 45,
      complete: true,
      models: ["model-a", "model-b"],
    });
    expect(summary?.byModel).toEqual([
      expect.objectContaining({ model: "model-a" }),
      expect.objectContaining({ model: "model-b" }),
    ]);
    expect(summary?.byModel.find((entry) => entry.model === "model-a")?.totals).toMatchObject({
      uncachedInputTokens: 150,
      outputTokens: 15,
    });
  });

  it("prices a turn that names no model at the model the stage was asked to run, without claiming it ran", () => {
    const summary = summarizeStageUsage([turn(complete())], "asked-for");
    expect(summary?.byModel.map((entry) => entry.model)).toEqual(["asked-for"]);
    expect(summary?.usage.models).toBeUndefined();
  });

  it("cannot price a turn that names several models", () => {
    const summary = summarizeStageUsage([turn(complete({ models: ["a", "b"] }))], "asked-for");
    expect(summary?.byModel.map((entry) => entry.model)).toEqual([null]);
    expect(summary?.usage.models).toEqual(["a", "b"]);
  });

  it.each([
    ["a turn that reported nothing beside one that did", [turn(complete()), turn(undefined)]],
    ["a partial turn", [turn(complete({ usageStatus: "partial" }))]],
    [
      "a turn with subagents whose tokens the provider did not report",
      [turn(complete({ hasSubagents: true }))],
    ],
  ])("is incomplete for %s", (_name, turns) => {
    expect(summarizeStageUsage(turns, "base")?.usage.complete).toBe(false);
  });

  it("leaves a local command's counters out", () => {
    const summary = summarizeStageUsage(
      [
        turn(complete({ localCommand: true })),
        turn(complete({ inputTokens: 10, outputTokens: 1 })),
      ],
      "base",
    );
    expect(summary?.usage).toMatchObject({
      uncachedInputTokens: 10,
      outputTokens: 1,
      complete: true,
    });
  });

  it("counts the subagent and compaction tokens a provider reported, apart from the ones it can price", () => {
    const summary = summarizeStageUsage(
      [
        turn(
          complete({
            inputTokens: 100_000,
            cachedInputTokens: 80_000,
            outputTokens: 40_000,
            otherUsage: { inputTokens: 900_000, outputTokens: 5_000 },
          }),
        ),
      ],
      "base",
    );
    expect(summary?.usage).toMatchObject({
      uncachedInputTokens: 20_000,
      cachedInputTokens: 80_000,
      outputTokens: 40_000,
      otherTokens: 905_000,
    });
    // Only the main agent's tokens have a model to price at.
    expect(summary?.byModel).toHaveLength(1);
  });

  it("is complete when the provider's own ledger accounts for the subagent and compaction work", () => {
    const compactionOnly = summarizeStageUsage(
      [turn(complete({ otherUsage: { inputTokens: 500, outputTokens: 50 } }))],
      "base",
    );
    expect(compactionOnly?.usage.complete).toBe(true);
    const subagents = summarizeStageUsage(
      [turn(complete({ hasSubagents: true, otherUsage: { inputTokens: 500, outputTokens: 50 } }))],
      "base",
    );
    expect(subagents?.usage.complete).toBe(true);
  });

  it("reports no other tokens when there were none", () => {
    expect(summarizeStageUsage([turn(complete())], "base")?.usage.otherTokens).toBeUndefined();
  });
});
