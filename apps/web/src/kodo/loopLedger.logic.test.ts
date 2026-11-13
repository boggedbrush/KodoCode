import type { KodoLoopLedgerTotals } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { describeKodoLoopLedger } from "./loopLedger.logic";

const totals = (over: Partial<KodoLoopLedgerTotals> = {}): KodoLoopLedgerTotals => ({
  loops: 3,
  rounds: 5,
  workers: 0,
  split: {
    loop: { tokens: 2_100_000, savedUsd: 10, priced: 3 },
    subAgents: { tokens: 0, savedUsd: 0, priced: 0 },
  },
  pricedLoops: 3,
  partialLoops: 0,
  unpricedLoops: 0,
  actualUsd: 2,
  referenceUsd: 12,
  savedUsd: 10,
  tokens: 2_100_000,
  noUsageLoops: 0,
  tokensByModel: [{ model: "small", tokens: 2_100_000 }],
  referenceModels: ["big"],
  ...over,
});

describe("describeKodoLoopLedger", () => {
  it("says nothing for an empty ledger", () => {
    expect(describeKodoLoopLedger(totals({ loops: 0, rounds: 0, pricedLoops: 0 }))).toMatchObject({
      counts: null,
      headline: null,
      tokens: null,
    });
  });

  it.each([
    { name: "an estimate", over: {}, headline: "Saved about $10.00" },
    {
      name: "a floor when a loop is partial",
      over: { partialLoops: 1 },
      headline: "Saved at least $10.00",
    },
    {
      name: "a negative total as costing more",
      over: { savedUsd: -4, actualUsd: 6, referenceUsd: 2 },
      headline: "Cost about $4.00 more than the reference model would have",
    },
    {
      name: "a negative partial total without 'at least'",
      over: { savedUsd: -4, partialLoops: 2 },
      headline: "Cost about $4.00 more than the reference model would have",
    },
    {
      name: "a zero total as no difference",
      over: { savedUsd: 0 },
      headline: "No difference in cost against the reference model",
    },
  ])("states $name", ({ over, headline }) => {
    expect(describeKodoLoopLedger(totals(over)).headline).toBe(headline);
  });

  it("labels the figure an estimate at API list prices and names the reference model", () => {
    const view = describeKodoLoopLedger(totals());
    expect(view.counts).toBe("3 loops, 5 rounds");
    expect(view.basis).toContain("An estimate at API list prices");
    expect(view.basis).toContain("on big would cost $12.00");
  });

  it("counts unpriced loops apart and never as zero savings", () => {
    const mixed = describeKodoLoopLedger(totals({ unpricedLoops: 2 }));
    expect(mixed.headline).toBe("Saved about $10.00");
    expect(mixed.notes.join(" ")).toContain(
      "2 loops could not be priced and are left out of the estimate, not counted as zero",
    );
    const none = describeKodoLoopLedger(
      totals({ pricedLoops: 0, unpricedLoops: 1, actualUsd: 0, referenceUsd: 0, savedUsd: 0 }),
    );
    expect(none.headline).toBeNull();
    expect(none.notes.join(" ")).toContain(
      "1 loop could not be priced. They are not counted as free.",
    );
  });

  it("explains a ledger with nothing to compare", () => {
    const view = describeKodoLoopLedger(totals({ pricedLoops: 0, savedUsd: 0 }));
    expect(view.headline).toBeNull();
    expect(view.notes[0]).toContain("nothing to compare against");
  });

  it("does not present missing usage as zero tokens", () => {
    const some = describeKodoLoopLedger(totals({ noUsageLoops: 1 }));
    expect(some.tokens).toBe("At least 2.1M tokens");
    expect(some.notes).toContain("1 loop reported no token usage.");
    const none = describeKodoLoopLedger(totals({ noUsageLoops: 3, tokens: 0, tokensByModel: [] }));
    expect(none.tokens).toBeNull();
    expect(none.notes).toContain("Token usage was not reported by the provider.");
  });
});

describe("the ledger with sub-agent workers", () => {
  const workers = (over: Partial<KodoLoopLedgerTotals> = {}) =>
    totals({
      loops: 2,
      rounds: 3,
      workers: 4,
      split: {
        loop: { tokens: 1_000_000, savedUsd: 6, priced: 2 },
        subAgents: { tokens: 1_100_000, savedUsd: 4, priced: 4 },
      },
      ...over,
    });

  it("counts both, and splits the saving by source", () => {
    const view = describeKodoLoopLedger(workers());
    expect(view.counts).toBe("2 loops, 3 rounds, 4 sub-agent workers");
    expect(view.split).toBe("Loops saved about $6.00; sub-agent workers saved about $4.00.");
  });

  it("is not empty with workers alone, and shows no split for one source", () => {
    const view = describeKodoLoopLedger(
      workers({
        loops: 0,
        rounds: 0,
        split: {
          loop: { tokens: 0, savedUsd: 0, priced: 0 },
          subAgents: { tokens: 1, savedUsd: 4, priced: 4 },
        },
      }),
    );
    expect(view.counts).toBe("4 sub-agent workers");
    expect(view.split).toBeNull();
  });
});
