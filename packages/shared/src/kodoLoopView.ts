// What a loop says about itself, in words: its title, what a person can do to it, why it stopped, and
// the summary a finished loop shows. Pure and shared by the web card and the mobile banner so neither
// restates the other. Every number here is either measured (tokens, a priced cost) or labelled an
// estimate (savings); a number the loop does not have is absent, never zero.
import {
  KODO_LOOP_MAX_ROUNDS,
  type KodoLoop,
  type KodoLoopShellStatus,
  type KodoLoopStage,
  type KodoLoopStageRecord,
  type KodoLoopStopReason,
} from "@t3tools/contracts";

const KODO_LOOP_STAGE_ORDER: ReadonlyArray<KodoLoopStage> = ["plan", "code", "review", "judge"];

export const KODO_LOOP_STAGE_LABEL: Record<KodoLoopStage, string> = {
  plan: "Plan",
  code: "Code",
  review: "Review",
  judge: "Judge",
};

/** What a headline needs of a loop: a thread shell's status carries it, and so does the full loop. */
export type KodoLoopHeadline = KodoLoopShellStatus;

export const isKodoLoopRunning = (loop: Pick<KodoLoopHeadline, "status"> | undefined): boolean =>
  loop !== undefined && (loop.status === "active" || loop.status === "held");

export type KodoLoopStageState = "done" | "current" | "upcoming" | "stopped";

/** Where each stage of the loop's current round stands, for the strip. */
export function kodoLoopStageStrip(
  loop: KodoLoop,
): ReadonlyArray<{ readonly stage: KodoLoopStage; readonly state: KodoLoopStageState }> {
  const finished = new Set(
    loop.stages
      .filter((record) => record.round === loop.round && record.status === "completed")
      .map((record) => record.stage),
  );
  return KODO_LOOP_STAGE_ORDER.map((stage) => {
    if (loop.status === "done") return { stage, state: "done" as const };
    if (stage === loop.stage) {
      return {
        stage,
        state: isKodoLoopRunning(loop) ? ("current" as const) : ("stopped" as const),
      };
    }
    return { stage, state: finished.has(stage) ? ("done" as const) : ("upcoming" as const) };
  });
}

/** "Round 2 of 3 · Review". */
const kodoLoopPlace = (loop: KodoLoopHeadline): string =>
  `Round ${loop.round} of ${loop.maxRounds} · ${KODO_LOOP_STAGE_LABEL[loop.stage]}`;

/** The card's heading: where a running loop is, or how a finished one ended. */
export function kodoLoopTitle(loop: KodoLoopHeadline): string {
  const place = kodoLoopPlace(loop);
  switch (loop.status) {
    case "active":
      return place;
    case "held":
      return loop.hold === "plan_approval" ? `${place} · Plan ready` : `${place} · Waiting`;
    case "done":
      return `Loop complete after ${loop.round} round${loop.round === 1 ? "" : "s"}`;
    case "stopped":
    case "failed":
      return `Loop stopped · ${place}`;
  }
}

/** Why the loop is held, in a sentence; null when it is not. */
export function kodoLoopHeldReason(loop: KodoLoopHeadline): string | null {
  if (loop.status !== "held") return null;
  return loop.hold === "plan_approval"
    ? "The plan is ready. Approve it to start coding, or stop the loop. A message you send also stops it."
    : "A stage is waiting for a request to be answered. The loop continues once it is.";
}

const STOP_TEXT: Record<KodoLoopStopReason, (loop: KodoLoopHeadline) => string> = {
  complete: () => "The Judge found the request complete.",
  round_cap: (loop) =>
    `Reached the limit of ${loop.maxRounds} round${loop.maxRounds === 1 ? "" : "s"} with work still outstanding.`,
  budget: (loop) => loop.stopDetail ?? "The budget was reached.",
  user_stop: () => "You stopped the loop.",
  user_message: () => "Stopped because a message was sent on the thread.",
  error: (loop) => loop.stopDetail ?? "A stage failed.",
  verdict_invalid: () => "The Judge's answer could not be read, so the loop stopped.",
  provider_limit: (loop) => loop.stopDetail ?? "The provider's usage limit was reached.",
};

/** Why a finished loop ended; null while it runs. */
export function kodoLoopStopText(loop: KodoLoopHeadline): string | null {
  if (isKodoLoopRunning(loop) || loop.stopReason === undefined) return null;
  return STOP_TEXT[loop.stopReason](loop);
}

export interface KodoLoopOutstanding {
  /** The Judge's one-line conclusion of that round. */
  readonly summary: string | null;
  readonly items: ReadonlyArray<string>;
  /** Items the loop kept a count of but not a title for. */
  readonly more: number;
}

/**
 * What the Judge last said was left, for a loop that ended without finishing: the newest judged
 * round's outstanding items, as the loop's records kept them. Null while the loop runs, when it
 * is complete, or when no round was ever judged as incomplete.
 */
export function kodoLoopOutstanding(loop: KodoLoop): KodoLoopOutstanding | null {
  if (isKodoLoopRunning(loop) || loop.status === "done") return null;
  const judged = loop.stages.findLast(
    (record) => record.stage === "judge" && record.verdict !== undefined,
  );
  const verdict = judged?.verdict;
  if (verdict === undefined || verdict.complete || verdict.outstandingCount === 0) return null;
  const items = verdict.outstanding.map((item) => item.title);
  return {
    summary: judged?.conclusion ?? null,
    items,
    more: Math.max(0, verdict.outstandingCount - items.length),
  };
}

export const KODO_LOOP_CONTEXT_NOTE =
  "This thread now continues from the last stage's conversation, not the whole loop.";

export interface KodoLoopActions {
  readonly stop: boolean;
  readonly approve: boolean;
  readonly retryJudge: boolean;
  /** How many rounds "Run N more rounds" adds; 0 when it is not offered. */
  readonly extendBy: number;
}

/** What the person can do to the loop right now. */
export function kodoLoopActions(
  loop: KodoLoopHeadline & Pick<KodoLoop, "maxRounds">,
  input: {
    readonly canOperate: boolean;
    readonly threadIdle: boolean;
    readonly extendRounds: number;
  },
): KodoLoopActions {
  const none = { stop: false, approve: false, retryJudge: false, extendBy: 0 };
  if (!input.canOperate) return none;
  if (isKodoLoopRunning(loop)) {
    return {
      ...none,
      stop: true,
      approve: loop.status === "held" && loop.hold === "plan_approval",
    };
  }
  if (!input.threadIdle) return none;
  const room = KODO_LOOP_MAX_ROUNDS - loop.maxRounds;
  return {
    ...none,
    retryJudge:
      loop.status === "failed" && loop.stopReason === "verdict_invalid" && loop.stage === "judge",
    extendBy:
      loop.status === "stopped" && loop.stopReason === "round_cap"
        ? Math.max(0, Math.min(input.extendRounds, room))
        : 0,
  };
}

export interface KodoLoopBanner {
  /** "Loop · Round 2 of 3 · Review", or how it ended. */
  readonly title: string;
  /** Why it is held, or why it stopped; null while it simply runs or when it completed. */
  readonly detail: string | null;
  readonly tone: "running" | "held" | "done" | "stopped" | "failed";
  readonly stop: boolean;
  readonly approve: boolean;
}

/**
 * The one-line banner a client without the full loop shows, from the status a thread shell carries.
 * A finished loop's banner is shown by the client for as long as it keeps the thread open.
 */
export function kodoLoopBanner(
  loop: KodoLoopHeadline,
  input: { readonly canOperate: boolean },
): KodoLoopBanner {
  const actions = kodoLoopActions(loop, { ...input, threadIdle: false, extendRounds: 0 });
  const title = isKodoLoopRunning(loop) ? `Loop · ${kodoLoopTitle(loop)}` : kodoLoopTitle(loop);
  return {
    title,
    detail: kodoLoopHeldReason(loop) ?? (loop.status === "done" ? null : kodoLoopStopText(loop)),
    tone: loop.status === "active" ? "running" : loop.status,
    stop: actions.stop,
    approve: actions.approve,
  };
}

const stageName = (round: number, stage: KodoLoopStage) =>
  `round ${round} ${KODO_LOOP_STAGE_LABEL[stage].toLowerCase()}`;

/** "1,234" below ten thousand, "12.3k" and "4.5M" above, so a token count stays a short word. */
export function formatKodoTokens(tokens: number): string {
  if (tokens < 10_000) return Math.round(tokens).toLocaleString("en-US");
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(tokens < 100_000 ? 1 : 0)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/** Dollars to the cent, and "<$0.01" for a real but tiny amount rather than a misleading "$0.00". */
export function formatKodoUsd(usd: number): string {
  if (usd > 0 && usd < 0.005) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

/** One line saying what a settled stage concluded. */
export function kodoLoopStageLine(record: KodoLoopStageRecord): string {
  const said = record.conclusion;
  const failed = record.status === "failed";
  switch (record.stage) {
    case "plan":
      return failed
        ? "No plan was produced."
        : said === undefined || said.toLowerCase() === "plan"
          ? "Plan ready."
          : said;
    case "code":
      return failed ? "The coding stage failed." : (said ?? "Coding finished.");
    case "review": {
      const review = record.review;
      if (review === undefined || !review.parsed || review.verdict === undefined) {
        return "The review's structured result could not be read; the Judge read its text.";
      }
      const counts =
        review.findings === 0
          ? "no findings"
          : `${review.findings} finding${review.findings === 1 ? "" : "s"}${review.high > 0 ? `, ${review.high} high` : ""}`;
      return `${review.verdict[0]!.toUpperCase()}${review.verdict.slice(1)}: ${counts}.${said === undefined ? "" : ` ${said}`}`;
    }
    case "judge": {
      if (failed || record.verdict === undefined) return "The Judge's answer could not be read.";
      const state = record.verdict.complete
        ? "Complete."
        : `${record.verdict.outstandingCount} outstanding.`;
      return `${state}${said === undefined ? "" : ` ${said}`}`;
    }
  }
}

export interface KodoLoopSummaryRound {
  readonly round: number;
  readonly stages: ReadonlyArray<{
    readonly stage: KodoLoopStage;
    readonly label: string;
    readonly line: string;
  }>;
}

export interface KodoLoopModelShare {
  readonly model: string;
  readonly tokens: number;
  /** Of the tokens that were reported, 0 to 100. */
  readonly sharePct: number;
}

export type KodoLoopSavingsView =
  /** Nothing to show: no Code or Plan stage has run yet. */
  | { readonly kind: "none" }
  /** Code and Plan stages ran, but no Judge or Review model is set to compare them against. */
  | { readonly kind: "no-reference" }
  /** Every compared stage ran on the reference model itself. */
  | { readonly kind: "same-model"; readonly referenceModel: string }
  /** Stages ran on a different model but none could be priced. */
  | {
      readonly kind: "unpriced";
      readonly referenceModel: string;
      readonly unpricedStages: ReadonlyArray<string>;
    }
  | {
      readonly kind: "estimate";
      readonly referenceModel: string;
      readonly actualUsd: number;
      readonly referenceUsd: number;
      readonly savedUsd: number;
      /** Negative when the stronger model would have cost less. */
      readonly savedPct: number;
      readonly pricedStages: number;
      readonly unpricedStages: ReadonlyArray<string>;
    };

export interface KodoLoopLimitChange {
  readonly stage: string;
  readonly windows: ReadonlyArray<{
    readonly window: string;
    readonly before: number;
    readonly after: number;
  }>;
}

export interface KodoLoopSummary {
  /** Rounds that ran, counting the one the loop stopped in. */
  readonly roundsRun: number;
  /** Earliest first; the card expands the last and folds the rest. */
  readonly rounds: ReadonlyArray<KodoLoopSummaryRound>;
  readonly stopText: string | null;
  /** Tokens the providers reported over all stages; null when none reported any. */
  readonly tokens: number | null;
  readonly byModel: ReadonlyArray<KodoLoopModelShare>;
  /** Priced cost of the stages that have a price; null when none has. */
  readonly costUsd: number | null;
  /** Stages that have tokens but no price: their cost is not in `costUsd`. */
  readonly unpricedStages: ReadonlyArray<string>;
  /** Stages whose provider reported no token usage at all. */
  readonly unreportedStages: ReadonlyArray<string>;
  /** Some stage reported only part of its tokens, so the totals are lower bounds. */
  readonly partial: boolean;
  /** Plain sentences about what the budget could and could not count. */
  readonly budgetNotes: ReadonlyArray<string>;
  readonly savings: KodoLoopSavingsView;
  readonly limitChanges: ReadonlyArray<KodoLoopLimitChange>;
}

const stageTokens = (usage: NonNullable<KodoLoopStageRecord["usage"]>) =>
  usage.uncachedInputTokens +
  usage.cachedInputTokens +
  usage.cacheCreationTokens +
  usage.outputTokens;

const modelOf = (record: KodoLoopStageRecord) =>
  record.usage?.models?.[0] ?? record.model?.model ?? "unknown model";

function savingsView(loop: KodoLoop): KodoLoopSavingsView {
  const { savings } = loop;
  if (savings === undefined) {
    return loop.stages.some((record) => record.stage === "code" || record.stage === "plan")
      ? { kind: "no-reference" }
      : { kind: "none" };
  }
  const unpricedStages = savings.unpricedStages.map(({ round, stage }) => stageName(round, stage));
  const referenceModel = savings.referenceModel.model;
  if (savings.pricedStages === 0) {
    return savings.unpricedStages.length === 0
      ? { kind: "same-model", referenceModel }
      : { kind: "unpriced", referenceModel, unpricedStages };
  }
  return {
    kind: "estimate",
    referenceModel,
    actualUsd: savings.actualUsd,
    referenceUsd: savings.referenceUsd,
    savedUsd: savings.savedUsd,
    savedPct: savings.savedPct,
    pricedStages: savings.pricedStages,
    unpricedStages,
  };
}

/** The summary of a loop that has run at least one stage; works on a running loop too. */
export function summarizeKodoLoop(loop: KodoLoop): KodoLoopSummary {
  const records = loop.stages.filter((record) => record.runId !== null);
  const roundNumbers = [...new Set(loop.stages.map((record) => record.round))].sort(
    (a, b) => a - b,
  );
  const rounds = roundNumbers.map((round): KodoLoopSummaryRound => ({
    round,
    stages: KODO_LOOP_STAGE_ORDER.flatMap((stage) =>
      loop.stages
        .filter((record) => record.round === round && record.stage === stage)
        .map((record) => ({
          stage,
          label: KODO_LOOP_STAGE_LABEL[stage],
          line: kodoLoopStageLine(record),
        })),
    ),
  }));

  let tokens = 0;
  let reported = 0;
  let costUsd = 0;
  let priced = 0;
  let partial = false;
  const unpricedStages: string[] = [];
  const unreportedStages: string[] = [];
  const perModel = new Map<string, number>();
  for (const record of records) {
    const usage = record.usage;
    if (usage === undefined) {
      unreportedStages.push(stageName(record.round, record.stage));
      continue;
    }
    reported += 1;
    const count = stageTokens(usage);
    tokens += count;
    perModel.set(modelOf(record), (perModel.get(modelOf(record)) ?? 0) + count);
    if (!usage.complete) partial = true;
    if (usage.costUsd === undefined) unpricedStages.push(stageName(record.round, record.stage));
    else {
      costUsd += usage.costUsd;
      priced += 1;
    }
  }

  const budgetNotes: string[] = [];
  if (loop.budget.maxCostUsd !== undefined && unpricedStages.length > 0) {
    budgetNotes.push(
      `The cost cap counted only stages with a price. It could not count ${unpricedStages.join(", ")}.`,
    );
  }
  if (loop.budget.maxTokens !== undefined && unreportedStages.length > 0) {
    budgetNotes.push(
      `The token cap could not count ${unreportedStages.join(", ")}: the provider reported no usage.`,
    );
  }
  if (loop.limitCheck !== undefined) {
    budgetNotes.push(
      loop.limitCheck.state === "missing"
        ? `${loop.limitCheck.provider} reports no usage-limit windows, so the limit setting could not stop this loop.`
        : `${loop.limitCheck.provider}'s usage-limit reading was out of date, so the limit setting could not stop this loop.`,
    );
  }

  return {
    roundsRun: roundNumbers.length === 0 ? 0 : (roundNumbers.at(-1) ?? 0),
    rounds,
    stopText: kodoLoopStopText(loop),
    tokens: reported === 0 ? null : tokens,
    byModel: [...perModel]
      .map(([model, count]) => ({
        model,
        tokens: count,
        sharePct: tokens === 0 ? 0 : (count / tokens) * 100,
      }))
      .sort((a, b) => b.tokens - a.tokens),
    costUsd: priced === 0 ? null : costUsd,
    unpricedStages,
    unreportedStages,
    partial,
    budgetNotes,
    savings: savingsView(loop),
    limitChanges: records.flatMap((record) =>
      record.limits === undefined || record.limits.length === 0
        ? []
        : [{ stage: stageName(record.round, record.stage), windows: record.limits }],
    ),
  };
}
