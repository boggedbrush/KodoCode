// Kodo sub-agents: a lead thread delegates implementation and review to worker threads (ordinary
// delegated tasks) that run on their mode's model slot. Pure data and constants; the rules are in
// apps/server/src/kodo/delegation and the shared client view is @t3tools/shared/kodoDelegation.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

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
