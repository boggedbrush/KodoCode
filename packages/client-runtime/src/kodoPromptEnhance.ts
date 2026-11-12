// Kodo prompt enhance: the request to the environment that owns a draft's thread. Like voice
// transcript cleanup, it is one authenticated HTTP call that runs a model there.
import { KodoPromptEnhanceError, type KodoInteractionMode } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as RemoteEnvironmentAuthorization from "./authorization/service.ts";
import type { PreparedConnection } from "./connection/model.ts";
import * as ManagedRelay from "./relay/managedRelay.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./state/environmentHttpAuth.ts";

// A model call is slower than a settings request but must not hang a draft forever.
const ENHANCE_TIMEOUT_MS = 2 * 60_000;

const isKodoPromptEnhanceError = Schema.is(KodoPromptEnhanceError);

export const enhancePromptOnEnvironment = Effect.fn("clientRuntime.kodoPromptEnhance")(function* (
  prepared: PreparedConnection,
  prompt: string,
  interactionMode: KodoInteractionMode,
) {
  return yield* executeAuthenticatedEnvironmentHttpRequest({
    group: "kodoPromptEnhance",
    prepared,
    signer: yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner),
    remoteAuthorization: yield* Effect.serviceOption(
      RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
    ),
    method: "POST",
    url: (urls) => urls.enhance(),
    timeoutMs: ENHANCE_TIMEOUT_MS,
    request: ({ client, headers }) =>
      client.enhance({ headers, payload: { prompt, interactionMode } }),
  }).pipe(
    // The shared client wraps endpoint-specific errors; the model's own reason is worth showing.
    Effect.mapError((error) =>
      error._tag === "RemoteEnvironmentAuthFetchError" && isKodoPromptEnhanceError(error.cause)
        ? error.cause
        : error,
    ),
    Effect.map((result) => result.prompt),
  );
});
