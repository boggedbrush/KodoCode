import { AuthOrchestrationOperateScope, EnvironmentHttpApi } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  requireEnvironmentScope,
} from "../auth/http.ts";
import * as KodoPromptEnhance from "./promptEnhance.ts";

export const promptEnhanceHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "kodoPromptEnhance",
  Effect.fnUntraced(function* (handlers) {
    const promptEnhance = yield* KodoPromptEnhance.KodoPromptEnhance;
    return handlers.handle(
      "enhance",
      Effect.fn("environment.kodoPromptEnhance.enhance")(function* (args) {
        yield* annotateEnvironmentRequest(args.endpoint.name);
        // It spends the environment's model, as a dictation cleanup does.
        yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
        return yield* promptEnhance.enhance(args.payload).pipe(
          Effect.catchTags({
            ServerSettingsError: (error) => failEnvironmentInternal("internal_error", error),
          }),
        );
      }),
    );
  }),
).pipe(Layer.provide(KodoPromptEnhance.layer));
