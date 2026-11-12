// Kodo prompt enhance: a one-shot rewrite of the composer draft by the environment's text
// generation model. It runs outside any thread, so it starts no turn and reads no workspace.
import * as Schema from "effect/Schema";
import * as HttpServerRespondable from "effect/http/HttpServerRespondable";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Longest draft Enhance rewrites. Longer drafts are refused, never truncated. */
export const KODO_PROMPT_ENHANCE_MAX_CHARS = 12_000;

export const KodoPromptEnhanceRequest = Schema.Struct({
  prompt: Schema.String.check(Schema.isMaxLength(KODO_PROMPT_ENHANCE_MAX_CHARS)),
  /** The thread's Kodo mode, which shapes the rewrite. The server reads absent or unknown as code. */
  interactionMode: Schema.optionalKey(Schema.String),
});
export type KodoPromptEnhanceRequest = typeof KodoPromptEnhanceRequest.Type;

export const KodoPromptEnhanceResult = Schema.Struct({ prompt: Schema.String });
export type KodoPromptEnhanceResult = typeof KodoPromptEnhanceResult.Type;

export const KodoPromptEnhanceFailureReason = Schema.Literals([
  // The text generation model or its provider could not answer; `detail` says why.
  "generation_failed",
  // The model answered with nothing usable.
  "empty_result",
]);
export type KodoPromptEnhanceFailureReason = typeof KodoPromptEnhanceFailureReason.Type;

export class KodoPromptEnhanceError extends Schema.TaggedError<KodoPromptEnhanceError>()(
  "KodoPromptEnhanceError",
  {
    reason: KodoPromptEnhanceFailureReason,
    detail: TrimmedNonEmptyString,
  },
  { httpApiStatus: 502 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(KodoPromptEnhanceError)(this, { status: 502 });
  }

  override get message(): string {
    return this.detail;
  }
}
