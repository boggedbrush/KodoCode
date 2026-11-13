// What the budget gate and the per-stage record read of a provider's usage limits. Provider health
// refreshes on a five-minute timer and only while a client watches, so a reading may be hours old when a
// loop runs unattended. The gate therefore asks the provider to read again, waits a few seconds at most,
// and acts only on a reading it knows the age of; anything older than the bound is "could not check".
import type { ServerProviderUsageLimits } from "@t3tools/contracts";
import { readKodoLimitWindows, type KodoLimitReading } from "@t3tools/shared/kodoLoopLimits";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

/** How long the gate waits for a provider to answer a request to read its limits again. */
export const KODO_LIMIT_REFRESH_WAIT_MS = 5_000;

/** A reading this recent is used as it is: the stage before it just asked, and a second probe would only repeat it. */
const KODO_LIMIT_REUSE_MS = 30_000;

export interface KodoLimitSource {
  /** The provider's usage limits as it holds them now. */
  readonly read: Effect.Effect<ServerProviderUsageLimits | undefined>;
  /** Asks the provider to read its limits again. Absent for a provider that cannot. May fail or hang. */
  readonly refresh?: Effect.Effect<unknown, { readonly _tag: string }> | undefined;
}

/** The provider's limit windows from a reading no older than the freshness bound, or why there is none. */
export const readFreshKodoLimits = Effect.fn("KodoLoopLimits.readFresh")(function* (
  source: KodoLimitSource,
): Effect.fn.Return<KodoLimitReading> {
  const held = readKodoLimitWindows(yield* source.read, yield* Clock.currentTimeMillis);
  if (
    held.state === "ok" &&
    (yield* Clock.currentTimeMillis) - held.checkedAtMs <= KODO_LIMIT_REUSE_MS
  ) {
    return held;
  }
  if (source.refresh !== undefined) {
    // A refresh that fails or does not answer in time leaves the reading as it was; it is judged below.
    yield* source.refresh.pipe(
      Effect.timeoutOption(KODO_LIMIT_REFRESH_WAIT_MS),
      Effect.ignoreCause,
    );
  }
  return readKodoLimitWindows(yield* source.read, yield* Clock.currentTimeMillis);
});
