import {
  normalizeKodoInteractionMode,
  type KodoReviewFinding,
  type KodoReviewResult,
  type KodoReviewSeverity,
  type ThreadInteractionMode,
} from "@t3tools/contracts";
import { parseKodoReview } from "@t3tools/shared/kodoLoopOutput";

/** A settled Review run's findings, parsed from its final reply. */
export interface KodoFindingsOffer {
  /** Names the offer, so dismissing it does not hide the next review's. */
  readonly key: string;
  readonly runId: string;
  /** The reply that holds the raw block the card replaces. */
  readonly messageId: string;
  readonly review: KodoReviewResult;
}

/**
 * The findings card is for the newest run only: it must have finished in Review mode and its final
 * reply must end with a valid `kodo-review` block. Any later run, in any mode, retires the card.
 * Runs that predate the recorded mode, and replies with a missing or unreadable block, offer nothing.
 */
export function findKodoFindingsOffer(input: {
  readonly latestRun: {
    readonly runId: string;
    readonly status: string;
    readonly assistantMessageId: string | null;
  } | null;
  readonly runs: ReadonlyArray<{
    readonly id: string;
    readonly interactionMode?: ThreadInteractionMode | undefined;
  }>;
  readonly messageText: (messageId: string) => string | null;
}): KodoFindingsOffer | null {
  const { latestRun } = input;
  if (
    latestRun === null ||
    latestRun.status !== "completed" ||
    latestRun.assistantMessageId === null
  ) {
    return null;
  }
  const mode = input.runs.find((run) => run.id === latestRun.runId)?.interactionMode;
  if (mode === undefined || normalizeKodoInteractionMode(mode) !== "review") return null;
  const text = input.messageText(latestRun.assistantMessageId);
  if (text === null) return null;
  const parsed = parseKodoReview(text);
  return parsed.ok
    ? {
        key: `run:${latestRun.runId}`,
        runId: latestRun.runId,
        messageId: latestRun.assistantMessageId,
        review: parsed.value,
      }
    : null;
}

const SEVERITY_RANK: Record<KodoReviewSeverity, number> = { high: 0, medium: 1, low: 2 };

/** Most serious first; findings of one severity keep the reviewer's order. */
export function sortKodoFindings(
  findings: ReadonlyArray<KodoReviewFinding>,
): ReadonlyArray<KodoReviewFinding> {
  return findings.toSorted(
    (left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity],
  );
}

/** "path:line", "path", or null when the finding is not tied to a file. */
export function kodoFindingLocation(finding: KodoReviewFinding): string | null {
  if (finding.file === undefined) return null;
  return finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** The card's one-line title: what the review found, most serious first. */
export function kodoFindingsTitle(review: KodoReviewResult): string {
  const total = review.findings.length;
  if (total === 0) return "Review passed";
  const high = review.findings.filter((finding) => finding.severity === "high").length;
  const found = plural(total, "finding");
  if (review.verdict === "blocking") return `Review found ${found}, ${high} blocking`;
  return `Review found ${found}`;
}

/** Findings can be handed to Code only when the review listed some. */
const kodoFindingsActionable = (review: KodoReviewResult): boolean => review.findings.length > 0;

/**
 * The thread that runs a findings fix: always Code, with every finding in the message, most serious
 * first. The agent is told to fix what is listed and nothing else.
 */
export function buildFindingsFixTurn(review: KodoReviewResult) {
  const lines = sortKodoFindings(review.findings).map((finding, index) => {
    const location = kodoFindingLocation(finding);
    return [
      `${index + 1}. [${finding.severity}] ${finding.title}${location === null ? "" : ` (${location})`}`,
      `   ${finding.detail}`,
      ...(finding.fix === undefined ? [] : [`   Suggested fix: ${finding.fix}`]),
    ].join("\n");
  });
  return {
    text: `A review of the working changes found these issues. Fix each one, changing only what it needs; if a finding is wrong, say so instead of changing the code.\n\n${lines.join("\n\n")}`,
    interactionMode: "code" as const,
  };
}

/** Whether the card is on screen: an offer, not dismissed. */
export function shouldShowFindingsCard(input: {
  readonly offer: KodoFindingsOffer | null;
  readonly dismissedOfferKey: string | null;
}): boolean {
  return input.offer !== null && input.offer.key !== input.dismissedOfferKey;
}

/** Whether "Fix in Code" can start now: the thread is operable and idle, and there is something to fix. */
export function canFixFindings(input: {
  readonly offer: KodoFindingsOffer | null;
  readonly dismissedOfferKey: string | null;
  readonly latestRunSettled: boolean;
  readonly pendingUserInputCount: number;
  readonly canOperateThread: boolean;
}): boolean {
  return (
    input.offer !== null &&
    shouldShowFindingsCard(input) &&
    kodoFindingsActionable(input.offer.review) &&
    input.canOperateThread &&
    input.latestRunSettled &&
    input.pendingUserInputCount === 0
  );
}
