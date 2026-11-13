// The usage-limit gate before a worker starts, built from the loop's own limit reading: the fullest
// window of the provider the worker will run on, read fresh, against the loop's "stop at" percent.
// A provider that reports no windows does not stop work; a reading that is stale, or an error while
// reading, refuses, so a limit that cannot be checked is not skipped.
import { OrchestratorMcpFailure, type ServerProvider } from "@t3tools/contracts";
import { fullestKodoLimitWindow } from "@t3tools/shared/kodoLoopLimits";
import * as Effect from "effect/Effect";

import { readFreshKodoLimits, type KodoLimitSource } from "../loop/limitReading.ts";
import { KODO_WORKER_LIMIT_UNREADABLE, kodoWorkerLimitRefusal } from "./limits.ts";

type KodoReadError = { readonly _tag: string };

export interface KodoWorkerLimitDeps {
  readonly providers: Effect.Effect<
    ReadonlyArray<Pick<ServerProvider, "instanceId" | "driver" | "displayName" | "usageLimits">>,
    KodoReadError
  >;
  /** The loop's `stopAtLimitPercent` setting. */
  readonly stopAtPercent: Effect.Effect<number, KodoReadError>;
  /** The instance's own snapshot, when the server can read it more directly than the provider list. */
  readonly readLimits?: ((instanceId: string) => KodoLimitSource["read"]) | undefined;
  readonly refreshLimits?: ((instanceId: string) => KodoLimitSource["refresh"]) | undefined;
}

export const kodoGuardWorkerLimit = Effect.fn("KodoDelegation.guardLimit")(function* (
  deps: KodoWorkerLimitDeps,
  instanceId: string,
) {
  return yield* Effect.gen(function* () {
    const providers = yield* deps.providers;
    const provider = providers.find((candidate) => candidate.instanceId === instanceId);
    const reading = yield* readFreshKodoLimits({
      read:
        deps.readLimits?.(instanceId) ??
        Effect.succeed(
          providers.find((candidate) => candidate.instanceId === instanceId)?.usageLimits,
        ),
      refresh: deps.refreshLimits?.(instanceId),
    });
    if (reading.state === "stale") {
      return yield* new OrchestratorMcpFailure({
        code: "capability_denied",
        message: KODO_WORKER_LIMIT_UNREADABLE,
      });
    }
    const fullest = fullestKodoLimitWindow(reading);
    if (fullest === null) return;
    const refusal = kodoWorkerLimitRefusal({
      provider: provider?.displayName ?? provider?.driver ?? instanceId,
      percent: fullest.usedPercent,
      window: fullest.name,
      stopAtPercent: yield* deps.stopAtPercent,
    });
    if (refusal !== undefined) {
      return yield* new OrchestratorMcpFailure({ code: "capability_denied", message: refusal });
    }
  }).pipe(
    Effect.mapError((error) =>
      error._tag === "OrchestratorMcpFailure"
        ? (error as OrchestratorMcpFailure)
        : new OrchestratorMcpFailure({
            code: "capability_denied",
            message: KODO_WORKER_LIMIT_UNREADABLE,
          }),
    ),
  );
});
