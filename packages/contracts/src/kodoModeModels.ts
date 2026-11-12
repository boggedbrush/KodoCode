// Kodo per-mode default models: which model a turn runs on in each interaction mode, plus the
// not-yet-consumed Orchestrator slot. Stored in server settings next to `defaultModelSelection`;
// resolved by `@t3tools/shared/kodoModeModel` (client preview) and apps/server/src/kodo/modeModel.ts.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { ModelSelection } from "./modelSelection.ts";

const KODO_MODE_MODEL_SLOTS = ["ask", "plan", "code", "review", "orchestrator", "judge"] as const;
export const KodoModeModelSlot = Schema.Literals(KODO_MODE_MODEL_SLOTS);
export type KodoModeModelSlot = typeof KodoModeModelSlot.Type;

// A slot that is not a valid selection (a malformed value from a newer or foreign build) reads as
// unset. The slot's encoded side is `unknown`: `withDecodingDefault` on the section validates the
// section's encoded side first, so a catch placed on the decoded side would never see the bad slot
// and the whole section would fall back to unset, erasing the valid slots next to it on the next save.
const decodeSelection = Schema.decodeUnknownOption(ModelSelection);
const Slot = Schema.Unknown.pipe(
  Schema.decodeTo(
    Schema.NullOr(ModelSelection),
    SchemaTransformation.transform({
      decode: (raw) =>
        raw === null || raw === undefined || Option.isNone(decodeSelection(raw))
          ? null
          : (raw as typeof ModelSelection.Encoded),
      encode: (value): unknown => value,
    }),
  ),
  Schema.withDecodingDefault(Effect.succeed(null)),
);

/**
 * Null follows the thread's own model, except judge, which follows review (then the thread's model).
 * Orchestrator and judge are roles, not modes a thread can be switched into. Unknown keys are ignored.
 */
export const KodoModeModels = Schema.Struct({
  ask: Slot,
  plan: Slot,
  code: Slot,
  review: Slot,
  orchestrator: Slot,
  judge: Slot,
});
export type KodoModeModels = typeof KodoModeModels.Type;

export const DEFAULT_KODO_MODE_MODELS: KodoModeModels = {
  ask: null,
  plan: null,
  code: null,
  review: null,
  orchestrator: null,
  judge: null,
};

/** The settings field: absent, or anything that is not a record of slots, reads as all unset. */
export const KodoModeModelsSetting = KodoModeModels.pipe(
  Schema.catchDecoding(() => Effect.succeedSome(DEFAULT_KODO_MODE_MODELS)),
  Schema.withDecodingDefault(Effect.succeed({})),
);

/** A settings patch sets only the slots it names, so two clients editing different modes do not clobber each other. */
export const KodoModeModelsPatch = Schema.Struct({
  ask: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  plan: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  code: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  review: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  orchestrator: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  judge: Schema.optionalKey(Schema.NullOr(ModelSelection)),
});
export type KodoModeModelsPatch = typeof KodoModeModelsPatch.Type;

export const KodoModelSource = Schema.Literals(["explicit", "mode-default", "thread"]);
export type KodoModelSource = typeof KodoModelSource.Type;

/** Kept on a thread while a mode default stands in for its own model; see kodoThreadOwnModel. */
export const KodoThreadModeModel = Schema.Struct({
  applied: ModelSelection,
  base: ModelSelection,
});
export type KodoThreadModeModel = typeof KodoThreadModeModel.Type;

/** Kept on a run: where its model came from, and the thread's own model when it was created. */
export const KodoRunModel = Schema.Struct({
  source: KodoModelSource,
  base: ModelSelection,
  /** The mode's configured model, when it could not be used and the run fell back to `base`. */
  unavailable: Schema.optional(Schema.Struct({ wanted: ModelSelection, reason: Schema.String })),
});
export type KodoRunModel = typeof KodoRunModel.Type;
