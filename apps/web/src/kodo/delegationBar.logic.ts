// What the delegation bar says: whose worker a thread is, and what a lead and its workers spent. Every
// figure follows the loop summary's honesty rules (an estimate at list prices, "at least" for a floor,
// an unpriced model is "no price" and never free), through the same formatters.
import {
  normalizeKodoInteractionMode,
  type KodoDelegationSpend,
  type KodoDelegationUsage,
  type KodoLead,
  type OrchestrationV2Subagent,
} from "@t3tools/contracts";
import { formatKodoTokens, formatKodoUsd } from "@t3tools/shared/kodoLoopView";

import { kodoInteractionModeOption } from "./interactionModes.logic";

/** The thread is a worker of a thread that leads sub-agents. */
export const kodoWorkerOf = (input: {
  readonly relationshipToParent: string | null | undefined;
  readonly parent: {
    readonly title: string;
    readonly kodoLead?: KodoLead | null | undefined;
  } | null;
}): { readonly leadTitle: string } | null =>
  input.relationshipToParent === "subagent" && input.parent?.kodoLead?.kind === "sub-agents"
    ? { leadTitle: input.parent.title }
    : null;

export const kodoWorkerModeLabel = (mode: unknown): string =>
  kodoInteractionModeOption(normalizeKodoInteractionMode(mode)).label;

const spendText = (spend: KodoDelegationSpend): string => {
  const floor = spend.complete ? "" : "at least ";
  const tokens = `${floor}${formatKodoTokens(spend.tokens)} tokens`;
  return spend.costUsd === undefined
    ? `${tokens}, no price`
    : `${tokens}, ${floor}${formatKodoUsd(spend.costUsd)}`;
};

export interface KodoDelegationUsageView {
  readonly lead: string | null;
  readonly workers: string | null;
  readonly savings: string | null;
}

/** Null while there is nothing to say: no worker has run and the lead has reported nothing. */
export function describeKodoDelegationUsage(
  usage: KodoDelegationUsage,
): KodoDelegationUsageView | null {
  if (usage.workerCount === 0 && usage.lead === undefined) return null;
  const { savings } = usage;
  let savingsText: string | null = null;
  if (savings !== undefined) {
    if (savings.pricedWorkers > 0) {
      const amount = formatKodoUsd(Math.abs(savings.savedUsd));
      const percent = `${Math.round(Math.abs(savings.savedPct))}%`;
      const partial = savings.unpricedWorkers > 0 ? " at least" : "";
      savingsText =
        savings.savedUsd < 0
          ? `Cost ${amount} more than ${savings.referenceModel.model} would have (${percent}, estimate)`
          : `Saved${partial} about ${amount} (${percent}) against ${savings.referenceModel.model} (estimate)`;
    } else if (savings.unpricedWorkers > 0) {
      savingsText = "No savings estimate: the workers' models have no price.";
    } else {
      savingsText = "Nothing to compare: the workers ran on the lead's model.";
    }
  }
  const unreported =
    usage.unreportedWorkers === 0 ? "" : `, ${usage.unreportedWorkers} not reported`;
  return {
    lead: usage.lead === undefined ? null : `Lead ${spendText(usage.lead)}`,
    workers:
      usage.workerCount === 0
        ? null
        : usage.workers === undefined
          ? `${usage.workerCount === 1 ? "1 worker" : `${usage.workerCount} workers`}: no usage reported`
          : `${usage.workerCount === 1 ? "1 worker" : `${usage.workerCount} workers`} ${spendText(usage.workers)}${unreported}`,
    savings: savingsText,
  };
}

const TERMINAL: ReadonlySet<OrchestrationV2Subagent["status"]> = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

/**
 * Changes exactly when a worker finishes or starts, so the usage is re-read then and not on every
 * message the lead streams.
 */
export const kodoUsageRefreshKey = (
  subagents: ReadonlyArray<Pick<OrchestrationV2Subagent, "origin" | "status">> | null,
): string => {
  const workers = (subagents ?? []).filter((task) => task.origin === "app_owned");
  return `${workers.length}:${workers.filter((task) => TERMINAL.has(task.status)).length}`;
};
