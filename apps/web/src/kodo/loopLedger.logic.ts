// What the Usage page says about the loop savings ledger. The wording follows the loop summary's
// honesty rules: the saved figure is an estimate at API list prices, "at least" when any loop's figure
// leaves something out, unpriced loops are counted apart and never as zero, and a negative total says
// it cost more.
import type { KodoLoopLedgerTotals } from "@t3tools/contracts";
import { formatKodoTokens, formatKodoUsd } from "@t3tools/shared/kodoLoopView";

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

export interface KodoLoopLedgerView {
  /** "12 loops, 31 rounds, 4 workers"; null for an empty ledger. */
  readonly counts: string | null;
  /** The estimate in one sentence; null when no loop has a savings figure. */
  readonly headline: string | null;
  /** What the figure was computed from; null with the headline. */
  readonly basis: string | null;
  /** Plain sentences about what the figures leave out, or why there is no estimate. */
  readonly notes: ReadonlyArray<string>;
  /** Where the savings came from, when loops and sub-agent workers both have a figure. */
  readonly split: string | null;
  readonly tokens: string | null;
  readonly tokensByModel: ReadonlyArray<{ readonly model: string; readonly tokens: string }>;
}

export const KODO_LOOP_LEDGER_EMPTY_NOTE =
  "Savings are recorded from loops and sub-agent work that finish after this version. Earlier work is not back-filled.";

export function describeKodoLoopLedger(totals: KodoLoopLedgerTotals): KodoLoopLedgerView {
  const units = totals.loops + totals.workers;
  if (units === 0) {
    return {
      counts: null,
      headline: null,
      basis: null,
      notes: [],
      split: null,
      tokens: null,
      tokensByModel: [],
    };
  }
  // Units are loops until a worker has been recorded; then a figure may belong to either.
  const one = totals.workers === 0 ? "loop" : "loop or worker";
  const many = totals.workers === 0 ? "loops" : "loops or workers";
  const notes: string[] = [];
  let headline: string | null = null;
  let basis: string | null = null;
  if (totals.pricedLoops > 0) {
    const amount = formatKodoUsd(Math.abs(totals.savedUsd));
    const partial = totals.partialLoops > 0;
    headline =
      totals.savedUsd < 0
        ? `Cost about ${amount} more than the reference model would have`
        : totals.savedUsd === 0
          ? "No difference in cost against the reference model"
          : partial
            ? `Saved at least ${amount}`
            : `Saved about ${amount}`;
    const reference =
      totals.referenceModels.length === 0
        ? "the reference model"
        : totals.referenceModels.join(", ");
    basis = `Ran for ${formatKodoUsd(totals.actualUsd)}; the same tokens on ${reference} would cost ${formatKodoUsd(totals.referenceUsd)}. An estimate at API list prices: a stronger model would use different token counts.`;
    if (partial) {
      notes.push(
        `${plural(totals.partialLoops, `priced ${one}`, `priced ${many}`)} leave${totals.partialLoops === 1 ? "s" : ""} out a stage with no price or partial usage.`,
      );
    }
  } else if (totals.unpricedLoops === 0) {
    notes.push(
      "No savings estimate: these loops had nothing to compare against (their stages ran on the reference model, or no Judge or Review model was set).",
    );
  }
  if (totals.unpricedLoops > 0) {
    notes.push(
      totals.pricedLoops === 0
        ? `No savings estimate: ${plural(totals.unpricedLoops, one, many)} could not be priced. They are not counted as free.`
        : `${plural(totals.unpricedLoops, one, many)} could not be priced and ${totals.unpricedLoops === 1 ? "is" : "are"} left out of the estimate, not counted as zero.`,
    );
  }
  const reported = totals.noUsageLoops < units;
  if (totals.noUsageLoops > 0) {
    notes.push(
      reported
        ? `${plural(totals.noUsageLoops, one, many)} reported no token usage.`
        : "Token usage was not reported by the provider.",
    );
  }
  return {
    counts: [
      ...(totals.loops === 0
        ? []
        : [`${plural(totals.loops, "loop")}, ${plural(totals.rounds, "round")}`]),
      ...(totals.workers === 0 ? [] : [plural(totals.workers, "sub-agent worker")]),
    ].join(", "),
    headline,
    basis,
    notes,
    split: splitLine(totals),
    tokens: reported
      ? `${totals.noUsageLoops > 0 ? "At least " : ""}${formatKodoTokens(totals.tokens)} tokens`
      : null,
    tokensByModel: totals.tokensByModel.map((entry) => ({
      model: entry.model,
      tokens: formatKodoTokens(entry.tokens),
    })),
  };
}

/** "Loops saved about $1.20; sub-agent workers about $0.40": only when both have a priced figure. */
function splitLine(totals: KodoLoopLedgerTotals): string | null {
  const { loop, subAgents } = totals.split;
  if (loop.priced === 0 || subAgents.priced === 0) return null;
  const part = (label: string, usd: number) =>
    `${label} ${usd < 0 ? "cost about" : "saved about"} ${formatKodoUsd(Math.abs(usd))}`;
  return `${part("Loops", loop.savedUsd)}; ${part("sub-agent workers", subAgents.savedUsd)}.`;
}
