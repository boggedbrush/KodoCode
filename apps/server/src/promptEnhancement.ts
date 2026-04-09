/**
 * PromptEnhancement - Shared prompt builder for pre-send prompt rewriting.
 *
 * Keeps the enhancement instructions centralized so Codex, Claude, and future
 * providers can reuse the same contract.
 *
 * @module PromptEnhancement
 */
import { Schema } from "effect";

import { PromptEnhancePreset } from "@t3tools/contracts";

import { limitSection } from "./git/Utils.ts";

export interface PromptEnhancementPromptInput {
  cwd: string;
  prompt: string;
  preset: PromptEnhancePreset;
  workspaceContext?: string;
}

const PromptEnhancementOutputSchema = Schema.Struct({
  prompt: Schema.String,
});

function presetInstructions(preset: PromptEnhancePreset): ReadonlyArray<string> {
  switch (preset) {
    case "minimal":
      return [
        "Correct grammar, spelling, punctuation, and tiny clarity issues only.",
        "Preserve the user's wording, scope, and intent as closely as possible.",
        "Do not add new requirements, repo assumptions, or technical jargon.",
      ];
    case "balanced":
      return [
        "Rewrite the prompt for clarity and stronger execution intent.",
        "Make implicit constraints explicit when they are already supported by the user's request or workspace context.",
        "Keep the rewrite compact, practical, and faithful to the user's goal.",
      ];
    case "vibe":
      return [
        "Rewrite the prompt from scratch for maximum coding-agent performance.",
        "Use technical, implementation-oriented wording when it helps execution.",
        "Keep the user's actual task intact and do not invent unsupported repo facts.",
      ];
  }
}

export function buildPromptEnhancementPrompt(input: PromptEnhancementPromptInput) {
  const promptSections = [
    "You are enhancing a draft user prompt before it is sent to a coding agent.",
    `Preset: ${input.preset}.`,
    "Return a JSON object with key: prompt.",
    "Rules:",
    "- preserve any @mentions, slash commands, and inline terminal placeholders exactly as-is",
    "- do not fabricate repository facts",
    "- do not change the user's actual task into a different task",
    "- output only the enhanced prompt text",
    ...presetInstructions(input.preset).map((rule) => `- ${rule}`),
    "",
    `Workspace root: ${input.cwd}`,
  ];

  if (input.workspaceContext?.trim()) {
    promptSections.push("", "Workspace context:", limitSection(input.workspaceContext, 12_000));
  }

  promptSections.push("", "Draft prompt:", limitSection(input.prompt, 12_000));

  return {
    prompt: promptSections.join("\n"),
    outputSchema: PromptEnhancementOutputSchema,
  };
}
