// KODO: delegation-ledger - a newer client reads an older server's ledger reply, which has no worker figures.
import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { KodoLoopLedgerTotals } from "./kodoLoopLedger.ts";

const decode = Schema.decodeUnknownSync(KodoLoopLedgerTotals);

const olderServerTotals = {
  loops: 2,
  rounds: 5,
  pricedLoops: 1,
  partialLoops: 0,
  unpricedLoops: 0,
  actualUsd: 1,
  referenceUsd: 3,
  savedUsd: 2,
  tokens: 1000,
  noUsageLoops: 0,
  tokensByModel: [],
  referenceModels: [],
};

describe("the ledger totals", () => {
  it("decode from a server that predates worker figures, as no workers", () => {
    const totals = decode(olderServerTotals);
    expect(totals.workers).toBe(0);
    expect(totals.split.subAgents).toEqual({ tokens: 0, savedUsd: 0, priced: 0 });
    expect(totals.split.loop).toEqual({ tokens: 0, savedUsd: 0, priced: 0 });
  });

  it("keep the figures a current server sends", () => {
    const split = {
      loop: { tokens: 600, savedUsd: 1, priced: 1 },
      subAgents: { tokens: 400, savedUsd: 1, priced: 2 },
    };
    expect(decode({ ...olderServerTotals, workers: 3, split })).toMatchObject({
      workers: 3,
      split,
    });
  });
});
