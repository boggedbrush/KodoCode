// Kodo sub-agents: a lead thread delegates implementation and review to worker threads (ordinary
// delegated tasks) that run on their mode's model slot. Pure data and constants; the rules are in
// apps/server/src/kodo/delegation and the shared client view is @t3tools/shared/kodoDelegation.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { NonNegativeInt, ThreadId } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

/** Live workers per lead: the setting's default, and the most the setting allows. */
export const KODO_SUB_AGENTS_DEFAULT_MAX_WORKERS = 3;
export const KODO_SUB_AGENTS_MAX_WORKERS_LIMIT = 6;
/** Workers one lead turn may start in all, whatever the setting says. */
export const KODO_SUB_AGENTS_MAX_WORKERS_PER_TURN = 8;

/** `swarm` is reserved for a later increment; this build only ever sets `sub-agents`. */
export const KodoLeadKind = Schema.Literals(["sub-agents", "swarm"]);
export type KodoLeadKind = typeof KodoLeadKind.Type;

export const KodoLead = Schema.Struct({ kind: KodoLeadKind });
export type KodoLead = typeof KodoLead.Type;

/** A stored lead this build cannot read (a newer kind) reads as no lead rather than failing the thread. */
export const LenientKodoLead = Schema.NullOr(KodoLead).pipe(
  Schema.catchDecoding(() => Effect.succeedSome(null)),
);

/** Whether a provider instance can receive the delegation tools. `none` always carries the reason. */
export const KodoSubAgentsSupport = Schema.Struct({
  support: Schema.Literals(["full", "none"]),
  /** Why the toggle is off; shown as the tooltip. */
  reason: Schema.optional(Schema.String),
  /** What stays unknown until a session opens, for a driver whose agent decides. */
  note: Schema.optional(Schema.String),
});
export type KodoSubAgentsSupport = typeof KodoSubAgentsSupport.Type;

/** What one side of a delegation spent, counted as the loop's token cap counts it. */
export const KodoDelegationSpend = Schema.Struct({
  tokens: NonNegativeInt,
  /** Absent: no price for a model that ran (unlisted, or subscription-only), never zero. */
  costUsd: Schema.optional(Schema.Number),
  /** False when a turn reported nothing or a provider left subagent work out: the figures are a floor. */
  complete: Schema.Boolean,
});
export type KodoDelegationSpend = typeof KodoDelegationSpend.Type;

/** The workers' cost against the same tokens at the lead's model. An estimate at list prices. */
export const KodoDelegationSavings = Schema.Struct({
  actualUsd: Schema.Number,
  referenceUsd: Schema.Number,
  savedUsd: Schema.Number,
  savedPct: Schema.Number,
  referenceModel: ModelSelection,
  /** Workers priced on both sides. */
  pricedWorkers: NonNegativeInt,
  /** Workers on another model that could not be priced: left out, never counted as free. */
  unpricedWorkers: NonNegativeInt,
  /** Workers that ran on the lead's own model: nothing to compare. */
  sameModelWorkers: NonNegativeInt,
});
export type KodoDelegationSavings = typeof KodoDelegationSavings.Type;

export const KodoDelegationUsage = Schema.Struct({
  threadId: ThreadId,
  /** The lead's own turns; absent when none reported. */
  lead: Schema.optional(KodoDelegationSpend),
  /** Every worker's turns together; absent when none reported. */
  workers: Schema.optional(KodoDelegationSpend),
  workerCount: NonNegativeInt,
  /** Workers whose provider reported no tokens at all. */
  unreportedWorkers: NonNegativeInt,
  savings: Schema.optional(KodoDelegationSavings),
});
export type KodoDelegationUsage = typeof KodoDelegationUsage.Type;

export class KodoDelegationUsageReadError extends Schema.TaggedError<KodoDelegationUsageReadError>()(
  "KodoDelegationUsageReadError",
  { cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return "The usage of this thread's workers could not be read.";
  }
}
