import {
  normalizeKodoInteractionMode,
  type KodoInteractionMode,
  type OrchestrationV2PlanArtifact,
  type PlanId,
  type ThreadId,
  type ThreadInteractionMode,
} from "@t3tools/contracts";
import { proposedPlanTitle } from "@t3tools/shared/proposedPlanText";

import { PLAN_IMPLEMENTATION_PROMPT_PREFIX } from "../proposedPlan";

/** What the thread's runs say about when Plan mode began; see `advanceKodoPlanEpoch`. */
export interface KodoPlanEpoch {
  readonly seenMode: KodoInteractionMode;
  /** Runs numbered at or below this ran before the thread entered Plan. Null: not known. */
  readonly cutoffOrdinal: number | null;
}

/**
 * Fallback for runs that predate `run.interactionMode`: the client keeps the newest run number
 * at the moment the thread last entered Plan. Only a run after it can be offered as a plan, so an
 * Ask answer is never offered for implementation. An unknown start (first seen already in Plan)
 * gates nothing.
 */
export function advanceKodoPlanEpoch(
  previous: KodoPlanEpoch | undefined,
  observed: { readonly mode: KodoInteractionMode; readonly latestRunOrdinal: number },
): KodoPlanEpoch {
  if (previous === undefined) return { seenMode: observed.mode, cutoffOrdinal: null };
  if (observed.mode === "plan" && previous.seenMode !== "plan") {
    return { seenMode: "plan", cutoffOrdinal: observed.latestRunOrdinal };
  }
  return previous.seenMode === observed.mode ? previous : { ...previous, seenMode: observed.mode };
}

export interface PlanEpochRun {
  readonly id: string;
  readonly ordinal: number;
  /** The mode the run recorded when it was created; absent on old runs. */
  readonly interactionMode?: ThreadInteractionMode | undefined;
}

function runIsInPlanEpoch(
  runs: ReadonlyArray<PlanEpochRun>,
  runId: string | null,
  cutoffOrdinal: number | null,
): boolean {
  const run = runId === null ? undefined : runs.find((candidate) => candidate.id === runId);
  if (run?.interactionMode !== undefined) {
    return normalizeKodoInteractionMode(run.interactionMode) === "plan";
  }
  if (cutoffOrdinal === null) return true;
  return run !== undefined && run.ordinal > cutoffOrdinal;
}

/** A plan the agent produced as a proposed-plan artifact. */
export interface ArtifactPlanOffer {
  readonly kind: "artifact";
  /** Names the offer, so dismissing it does not hide the next one. */
  readonly key: string;
  readonly id: PlanId;
  readonly markdown: string;
  readonly title: string | null;
}

/** A plan presented as the final reply of a run, for providers that produce no plan artifact. */
export interface ResponsePlanOffer {
  readonly kind: "response";
  readonly key: string;
  readonly runId: string;
  readonly messageId: string;
  readonly title: string | null;
}

export type KodoPlanOffer = ArtifactPlanOffer | ResponsePlanOffer;

/**
 * The plan a settled Plan-mode run is waiting on: the newest active proposed plan produced since
 * the thread entered Plan, preferring the latest run's. Todo lists are not plans to approve.
 */
export function findActionableProposedPlan(input: {
  readonly plans: ReadonlyArray<OrchestrationV2PlanArtifact>;
  readonly latestRunId: string | null;
  readonly runs: ReadonlyArray<PlanEpochRun>;
  readonly cutoffOrdinal: number | null;
}): ArtifactPlanOffer | null {
  const active = input.plans.filter(
    (plan): plan is Extract<OrchestrationV2PlanArtifact, { kind: "proposed_plan" }> =>
      plan.kind === "proposed_plan" &&
      plan.status === "active" &&
      runIsInPlanEpoch(input.runs, plan.runId, input.cutoffOrdinal),
  );
  const ofLatestRun =
    input.latestRunId === null ? [] : active.filter((plan) => plan.runId === input.latestRunId);
  const plan = (ofLatestRun.length > 0 ? ofLatestRun : active).at(-1);
  return plan === undefined
    ? null
    : {
        kind: "artifact",
        key: `plan:${plan.id}`,
        id: plan.id,
        markdown: plan.markdown,
        title: proposedPlanTitle(plan.markdown),
      };
}

/** First readable line of a reply, with markdown heading and list markers dropped. */
export function responseTitle(text: string): string | null {
  const line = text
    .split(/\r?\n/)
    .map((candidate) => candidate.replace(/^[\s#>*\-\d.)]+/, "").trim())
    .find((candidate) => candidate.length > 0);
  if (line === undefined) return null;
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

/**
 * For providers with no native plan capture: a Plan run that finished with an assistant reply
 * is itself the plan on offer.
 */
export function findResponsePlanOffer(input: {
  readonly latestRun: {
    readonly runId: string;
    readonly status: string;
    readonly assistantMessageId: string | null;
  } | null;
  readonly runs: ReadonlyArray<PlanEpochRun>;
  readonly cutoffOrdinal: number | null;
  readonly messageText: (messageId: string) => string | null;
}): ResponsePlanOffer | null {
  const { latestRun } = input;
  if (
    latestRun === null ||
    latestRun.status !== "completed" ||
    latestRun.assistantMessageId === null ||
    !runIsInPlanEpoch(input.runs, latestRun.runId, input.cutoffOrdinal)
  ) {
    return null;
  }
  const text = input.messageText(latestRun.assistantMessageId);
  if (text === null || text.trim().length === 0) return null;
  return {
    kind: "response",
    key: `run:${latestRun.runId}`,
    runId: latestRun.runId,
    messageId: latestRun.assistantMessageId,
    title: responseTitle(text),
  };
}

/** The proposed-plan artifact when there is one, else the settled reply. */
export function resolveKodoPlanOffer(input: {
  readonly plans: ReadonlyArray<OrchestrationV2PlanArtifact>;
  readonly runs: ReadonlyArray<PlanEpochRun>;
  readonly latestRun: Parameters<typeof findResponsePlanOffer>[0]["latestRun"];
  readonly cutoffOrdinal: number | null;
  readonly messageText: (messageId: string) => string | null;
}): KodoPlanOffer | null {
  return (
    findActionableProposedPlan({
      plans: input.plans,
      latestRunId: input.latestRun?.runId ?? null,
      runs: input.runs,
      cutoffOrdinal: input.cutoffOrdinal,
    }) ?? findResponsePlanOffer(input)
  );
}

/**
 * Offer approval only while the thread is in Plan and idle, no question is still open, the
 * person can operate the thread, and the offer was not dismissed. Checked again at click time.
 */
export function shouldOfferPlanAcceptance(input: {
  readonly interactionMode: ThreadInteractionMode;
  readonly latestRunSettled: boolean;
  readonly pendingUserInputCount: number;
  readonly offer: KodoPlanOffer | null;
  readonly dismissedOfferKey: string | null;
  readonly canOperateThread: boolean;
}): boolean {
  return (
    normalizeKodoInteractionMode(input.interactionMode) === "plan" &&
    input.canOperateThread &&
    input.latestRunSettled &&
    input.pendingUserInputCount === 0 &&
    input.offer !== null &&
    input.offer.key !== input.dismissedOfferKey
  );
}

export const PLAN_RESPONSE_IMPLEMENTATION_PROMPT =
  "The plan you just presented is approved. Implement it now; you can modify the workspace.";

/** The turn that implements an approved plan: always Code, linked to the plan when there is one. */
export function buildPlanAcceptanceTurn(input: {
  readonly threadId: ThreadId;
  readonly offer: KodoPlanOffer;
}) {
  return input.offer.kind === "artifact"
    ? {
        text: `${PLAN_IMPLEMENTATION_PROMPT_PREFIX}${input.offer.markdown.trim()}`,
        interactionMode: "code" as const,
        sourceProposedPlan: { threadId: input.threadId, planId: input.offer.id },
      }
    : {
        text: PLAN_RESPONSE_IMPLEMENTATION_PROMPT,
        interactionMode: "code" as const,
        sourceProposedPlan: undefined,
      };
}

export type PlanAcceptanceStep =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string; readonly interrupted: boolean };

export type PlanAcceptanceOutcome =
  | { readonly status: "skipped" }
  | { readonly status: "started" }
  | {
      readonly status: "failed";
      /** The mode switch failed (the thread stayed in Plan) or the turn did (Code was rolled back). */
      readonly stage: "mode" | "turn";
      /** Null when the failure needs no report, such as an interrupted command. */
      readonly message: string | null;
    };

/**
 * Accepting a plan, in order: re-check the offer, switch the thread to Code, start the turn, and
 * on a failed start put the thread back in Plan. The
 * switch and the start are two server commands, so the rollback is what keeps the thread's mode
 * and the unimplemented plan consistent for every client.
 */
export async function runKodoPlanAcceptance(deps: {
  readonly stillOffered: () => boolean;
  readonly switchToCode: () => Promise<PlanAcceptanceStep>;
  readonly startTurn: () => Promise<PlanAcceptanceStep>;
  readonly returnToPlan: () => Promise<PlanAcceptanceStep>;
}): Promise<PlanAcceptanceOutcome> {
  if (!deps.stillOffered()) return { status: "skipped" };
  const switched = await deps.switchToCode();
  if (!switched.ok) {
    return {
      status: "failed",
      stage: "mode",
      message: switched.interrupted ? null : switched.message,
    };
  }
  const started = await deps.startTurn();
  if (started.ok) return { status: "started" };
  const rollback = await deps.returnToPlan();
  const message = started.interrupted ? null : started.message;
  return {
    status: "failed",
    stage: "turn",
    message: rollback.ok
      ? message
      : `${message ?? "The plan did not start."} The thread also could not return to Plan: ${rollback.message}`,
  };
}
