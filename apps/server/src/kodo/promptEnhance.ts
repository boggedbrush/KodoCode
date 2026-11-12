// Kodo: rewrites a composer draft with the environment's text generation model. It runs in an
// empty scratch directory, so it creates no thread turn and reads no project files.
import {
  KodoPromptEnhanceError,
  type KodoPromptEnhanceRequest,
  type KodoPromptEnhanceResult,
  type ServerSettingsError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { buildPromptEnhancementPrompt } from "./promptEnhancePrompt.ts";

export class KodoPromptEnhance extends Context.Service<
  KodoPromptEnhance,
  {
    readonly enhance: (
      input: KodoPromptEnhanceRequest,
    ) => Effect.Effect<KodoPromptEnhanceResult, KodoPromptEnhanceError | ServerSettingsError>;
  }
>()("t3/kodo/promptEnhance/KodoPromptEnhance") {}

const MAX_DETAIL_CHARS = 300;

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const fileSystem = yield* FileSystem.FileSystem;
  const textGeneration = yield* TextGeneration.TextGeneration;
  return KodoPromptEnhance.of({
    enhance: Effect.fn("KodoPromptEnhance.enhance")(function* (input) {
      if (input.prompt.trim().length === 0) return { prompt: input.prompt };
      const settings = yield* settingsService.getSettings;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "kodo-enhance-" }).pipe(
        Effect.mapError(
          () =>
            new KodoPromptEnhanceError({
              reason: "generation_failed",
              detail: "Could not prepare a scratch directory for the rewrite.",
            }),
        ),
      );
      // Enhance rides the operation voice cleanup uses: the prompt is the whole request, the
      // reply is bare text, and no driver treats it as a coding turn. Provider choice, auth and
      // fallback are `TextGeneration`'s, as for commit messages and thread titles.
      const generated = yield* textGeneration
        .generateTranscriptionPostProcessing({
          cwd,
          prompt: buildPromptEnhancementPrompt(input.prompt, input.interactionMode),
          modelSelection: settings.textGenerationModelSelection,
        })
        .pipe(
          Effect.catchTags({
            TextGenerationError: (error) =>
              Effect.fail(
                new KodoPromptEnhanceError({
                  reason: "generation_failed",
                  detail: error.detail.slice(0, MAX_DETAIL_CHARS) || "Text generation failed.",
                }),
              ),
          }),
        );
      const text = generated.transcription.trim();
      if (text.length === 0) {
        return yield* new KodoPromptEnhanceError({
          reason: "empty_result",
          detail: "The model returned an empty prompt.",
        });
      }
      return { prompt: text };
    }, Effect.scoped),
  });
});

export const layer = Layer.effect(KodoPromptEnhance, make);
