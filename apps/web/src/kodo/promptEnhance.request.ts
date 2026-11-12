// Kodo prompt enhance: runs the environment request with the web client's connection runtime.
import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import { enhancePromptOnEnvironment } from "@t3tools/client-runtime/kodoPromptEnhance";
import type { KodoInteractionMode } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { inEnvironmentSpeechRuntime } from "../speech/runEnvironmentSpeech";

/** Resolves to the rewritten prompt; aborting `signal` cancels the request. */
export function requestPromptEnhancement(input: {
  readonly prepared: PreparedConnection;
  readonly prompt: string;
  readonly interactionMode: KodoInteractionMode;
  readonly signal: AbortSignal;
}): Promise<string> {
  return Effect.runPromise(
    inEnvironmentSpeechRuntime(
      enhancePromptOnEnvironment(input.prepared, input.prompt, input.interactionMode),
    ),
    { signal: input.signal },
  );
}
