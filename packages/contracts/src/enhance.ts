import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";

export const PromptEnhancePreset = Schema.Literals(["minimal", "balanced", "vibe"]);
export type PromptEnhancePreset = typeof PromptEnhancePreset.Type;

export const PromptEnhanceInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  prompt: Schema.String,
  preset: PromptEnhancePreset,
});
export type PromptEnhanceInput = typeof PromptEnhanceInput.Type;

export const PromptEnhanceResult = Schema.Struct({
  prompt: Schema.String,
});
export type PromptEnhanceResult = typeof PromptEnhanceResult.Type;
