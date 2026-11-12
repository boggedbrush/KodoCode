// Kodo loop: the plan, code, review, judge cycle that `/loop` starts on a thread. Pure data, no
// behaviour: the state machine is apps/server/src/kodo/loop, the output parser is
// @t3tools/shared/kodoLoopOutput, and the `loop` server-settings section is decoded here.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { IsoDateTime, MessageId, NonNegativeInt, PositiveInt, RunId } from "./baseSchemas.ts";
import { KodoInteractionMode } from "./kodoInteractionMode.ts";
import { ModelSelection } from "./modelSelection.ts";

export const KODO_LOOP_REQUEST_MAX_CHARS = 20_000;
export const KODO_LOOP_MAX_ROUNDS = 16;
export const KODO_LOOP_STAGES_PER_ROUND = 4;

export const KodoLoopStage = Schema.Literals(["plan", "code", "review", "judge"]);
export type KodoLoopStage = typeof KodoLoopStage.Type;

export const KodoLoopStatus = Schema.Literals(["active", "held", "done", "stopped", "failed"]);
export type KodoLoopStatus = typeof KodoLoopStatus.Type;

/** Why an `held` loop waits; only set while the status is `held`. */
export const KodoLoopHold = Schema.Literals(["plan_approval", "runtime_request"]);
export type KodoLoopHold = typeof KodoLoopHold.Type;

export const KodoLoopStopReason = Schema.Literals([
  "complete",
  "round_cap",
  "budget",
  "user_stop",
  "user_message",
  "error",
  "verdict_invalid",
  "provider_limit",
]);
export type KodoLoopStopReason = typeof KodoLoopStopReason.Type;

const capped = (max: number) => Schema.String.check(Schema.isMaxLength(max));
const cappedNonEmpty = (max: number) =>
  Schema.String.check(Schema.isMaxLength(max), Schema.isNonEmpty());

export const KODO_REVIEW_MAX_FINDINGS = 30;
export const KODO_VERDICT_MAX_OUTSTANDING = 20;

export const KodoLoopOutstandingItem = Schema.Struct({
  id: cappedNonEmpty(64),
  title: cappedNonEmpty(200),
  detail: capped(2_000),
});
export type KodoLoopOutstandingItem = typeof KodoLoopOutstandingItem.Type;

/**
 * The Judge's answer. `complete` and `outstanding` cannot contradict each other: a complete
 * verdict lists nothing outstanding, an incomplete one lists something and says how to proceed.
 */
export const KodoLoopVerdict = Schema.Struct({
  version: Schema.Literal(1),
  complete: Schema.Boolean,
  summary: capped(600),
  outstanding: Schema.Array(KodoLoopOutstandingItem).check(
    Schema.isMaxLength(KODO_VERDICT_MAX_OUTSTANDING),
  ),
  approach: capped(2_000),
}).check(
  Schema.makeFilter((verdict) =>
    verdict.complete
      ? verdict.outstanding.length === 0
        ? undefined
        : "a complete verdict must have no outstanding items"
      : verdict.outstanding.length === 0
        ? "an incomplete verdict must list at least one outstanding item"
        : verdict.approach.trim().length === 0
          ? "an incomplete verdict must say how to proceed (approach)"
          : undefined,
  ),
);
export type KodoLoopVerdict = typeof KodoLoopVerdict.Type;

export const KodoReviewSeverity = Schema.Literals(["high", "medium", "low"]);
export type KodoReviewSeverity = typeof KodoReviewSeverity.Type;

export const KodoReviewFinding = Schema.Struct({
  id: cappedNonEmpty(64),
  severity: KodoReviewSeverity,
  title: cappedNonEmpty(200),
  file: Schema.optional(cappedNonEmpty(500)),
  line: Schema.optional(PositiveInt),
  detail: capped(2_000),
  fix: Schema.optional(capped(2_000)),
});
export type KodoReviewFinding = typeof KodoReviewFinding.Type;

/**
 * A review's result. The verdict has to agree with the findings: blocking needs a high finding,
 * pass allows none, and concerns needs something to be concerned about.
 */
export const KodoReviewResult = Schema.Struct({
  version: Schema.Literal(1),
  verdict: Schema.Literals(["pass", "concerns", "blocking"]),
  summary: capped(600),
  findings: Schema.Array(KodoReviewFinding).check(Schema.isMaxLength(KODO_REVIEW_MAX_FINDINGS)),
}).check(
  Schema.makeFilter((review) => {
    const high = review.findings.some((finding) => finding.severity === "high");
    if (review.verdict === "blocking") {
      return high ? undefined : "a blocking review must include a high-severity finding";
    }
    if (review.verdict === "pass") {
      return high ? "a passing review cannot include a high-severity finding" : undefined;
    }
    return review.findings.length > 0 ? undefined : "a review with concerns must list findings";
  }),
);
export type KodoReviewResult = typeof KodoReviewResult.Type;

/** Tokens a stage used, in the ledger's terms; `complete` is false when a provider reported none. */
export const KodoLoopStageUsage = Schema.Struct({
  uncachedInputTokens: NonNegativeInt,
  cachedInputTokens: NonNegativeInt,
  cacheCreationTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  reasoningTokens: NonNegativeInt,
  complete: Schema.Boolean,
});
export type KodoLoopStageUsage = typeof KodoLoopStageUsage.Type;

export const KodoLoopStageRecord = Schema.Struct({
  round: PositiveInt,
  stage: KodoLoopStage,
  messageId: MessageId,
  runId: Schema.NullOr(RunId),
  status: Schema.Literals(["running", "completed", "failed"]),
  model: Schema.NullOr(ModelSelection),
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  usage: Schema.optional(KodoLoopStageUsage),
  /** The highest limit-window percentage of the stage's provider before and after the stage. */
  quotaBefore: Schema.optional(Schema.Number),
  quotaAfter: Schema.optional(Schema.Number),
  verdict: Schema.optional(KodoLoopVerdict),
  review: Schema.optional(KodoReviewResult),
  reviewParse: Schema.optional(Schema.Literals(["ok", "failed"])),
  planMarkdown: Schema.optional(capped(20_000)),
});
export type KodoLoopStageRecord = typeof KodoLoopStageRecord.Type;

export const KodoLoopBudget = Schema.Struct({
  maxCostUsd: Schema.optional(Schema.Number),
  maxTokens: Schema.optional(NonNegativeInt),
  stopAtLimitPercent: Schema.optional(Schema.Number),
});
export type KodoLoopBudget = typeof KodoLoopBudget.Type;

export const KodoLoopSavings = Schema.Struct({
  actualUsd: Schema.Number,
  referenceUsd: Schema.Number,
  savedUsd: Schema.Number,
  savedPct: Schema.Number,
  referenceModel: Schema.NullOr(ModelSelection),
  pricedStages: NonNegativeInt,
  unpricedStages: NonNegativeInt,
});
export type KodoLoopSavings = typeof KodoLoopSavings.Type;

export const KodoLoop = Schema.Struct({
  loopId: Schema.String.check(Schema.isNonEmpty()),
  /** Bumped by every operation; a writer that read an older one is refused. */
  revision: NonNegativeInt,
  status: KodoLoopStatus,
  hold: Schema.optional(KodoLoopHold),
  stopReason: Schema.optional(KodoLoopStopReason),
  stopDetail: Schema.optional(capped(2_000)),
  round: PositiveInt,
  maxRounds: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: KODO_LOOP_MAX_ROUNDS })),
  stage: KodoLoopStage,
  request: capped(KODO_LOOP_REQUEST_MAX_CHARS),
  requestMessageId: MessageId,
  /** The mode the thread returns to when the loop ends. */
  startMode: KodoInteractionMode,
  planApproval: Schema.Literals(["auto", "ask"]),
  budget: KodoLoopBudget,
  baseline: Schema.Struct({
    checkpointTurnCount: Schema.optional(NonNegativeInt),
    headSha: Schema.optional(Schema.String),
  }),
  stages: Schema.Array(KodoLoopStageRecord).check(
    Schema.isMaxLength(KODO_LOOP_MAX_ROUNDS * KODO_LOOP_STAGES_PER_ROUND),
  ),
  summary: Schema.optional(capped(8_000)),
  savings: Schema.optional(KodoLoopSavings),
});
export type KodoLoop = typeof KodoLoop.Type;

const KODO_LOOP_DEFAULT_MAX_ROUNDS = 3;
const KODO_LOOP_DEFAULT_STOP_AT_LIMIT_PERCENT = 90;

const MaxRounds = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: KODO_LOOP_MAX_ROUNDS }));
const PlanApproval = Schema.Literals(["auto", "ask"]);
const StopAtLimitPercent = Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 100 }));
const MaxCostUsd = Schema.NullOr(Schema.Number.check(Schema.isGreaterThan(0)));
const MaxTokens = Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)));

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Each field reads its own stored value and falls back to its default when that is not valid. The
// field's encoded side is `unknown`: a bad value must not fail the section, or the valid fields next
// to it would be erased on the next save (see kodoModeModels.ts, which solved this for slots).
const tolerantField = <T>(schema: Schema.Codec<T, T>, fallback: T) => {
  const isValid = Schema.is(schema);
  return Schema.Unknown.pipe(
    Schema.decodeTo(
      schema,
      SchemaTransformation.transform({
        decode: (raw): T => (isValid(raw) ? raw : fallback),
        encode: (value): unknown => value,
      }),
    ),
    Schema.withDecodingDefault(Effect.succeed(fallback)),
  );
};

// A section or sub-section that is not a record reads as empty, so every field takes its default.
const recordOrEmpty = SchemaTransformation.transform({
  decode: (raw: unknown) => (isPlainRecord(raw) ? raw : {}),
  encode: (value: Record<string, unknown>): unknown => value,
});

const KodoLoopBudgetSettings = Schema.Struct({
  stopAtLimitPercent: tolerantField(StopAtLimitPercent, KODO_LOOP_DEFAULT_STOP_AT_LIMIT_PERCENT),
  /** Null: no cap. */
  maxCostUsd: tolerantField(MaxCostUsd, null),
  maxTokens: tolerantField(MaxTokens, null),
});

const KodoLoopSettingsFields = Schema.Struct({
  defaultMaxRounds: tolerantField(MaxRounds, KODO_LOOP_DEFAULT_MAX_ROUNDS),
  planApproval: tolerantField(PlanApproval, "auto"),
  budget: Schema.Unknown.pipe(
    Schema.decodeTo(KodoLoopBudgetSettings, recordOrEmpty),
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
});

/** The settings field: absent or malformed pieces read as their defaults, field by field. */
export const KodoLoopSetting = Schema.Unknown.pipe(
  Schema.decodeTo(KodoLoopSettingsFields, recordOrEmpty),
  Schema.withDecodingDefault(Effect.succeed({})),
);
export type KodoLoopSettings = typeof KodoLoopSettingsFields.Type;

export const DEFAULT_KODO_LOOP_SETTINGS: KodoLoopSettings = Schema.decodeSync(
  KodoLoopSettingsFields,
)({});

/** A settings patch names only what it changes; null clears a cost or token cap. */
export const KodoLoopSettingsPatch = Schema.Struct({
  defaultMaxRounds: Schema.optionalKey(MaxRounds),
  planApproval: Schema.optionalKey(PlanApproval),
  budget: Schema.optionalKey(
    Schema.Struct({
      stopAtLimitPercent: Schema.optionalKey(StopAtLimitPercent),
      maxCostUsd: Schema.optionalKey(MaxCostUsd),
      maxTokens: Schema.optionalKey(MaxTokens),
    }),
  ),
});
export type KodoLoopSettingsPatch = typeof KodoLoopSettingsPatch.Type;
