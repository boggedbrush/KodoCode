import { describe, expect, it } from "@effect/vitest";
import type { ServerProviderUsageLimits } from "@t3tools/contracts";
import type { KodoLimitReading } from "@t3tools/shared/kodoLoopLimits";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import { KODO_LIMIT_REFRESH_WAIT_MS, readFreshKodoLimits } from "./limitReading.ts";

const NOW = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-06-01T12:00:00.000Z"));
const ago = (seconds: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW - seconds * 1000));

const limits = (usedPercent: number, checkedAgoSeconds: number): ServerProviderUsageLimits => ({
  checkedAt: ago(checkedAgoSeconds),
  windows: [
    { id: "session", kind: "session", label: "Session", usedPercent, windowDurationMins: 300 },
  ],
});

const percentOf = (reading: KodoLimitReading) =>
  reading.state === "ok" ? reading.windows[0]?.usedPercent : reading.state;

describe("reading a provider's limits for the gate", () => {
  it.effect("uses a reading that is already recent and asks the provider for nothing", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const asked = yield* Ref.make(0);
      const reading = yield* readFreshKodoLimits({
        read: Effect.succeed(limits(70, 10)),
        refresh: Ref.update(asked, (count) => count + 1),
      });
      expect(percentOf(reading)).toBe(70);
      expect(yield* Ref.get(asked)).toBe(0);
    }),
  );

  it.effect("asks the provider to read again when the reading is old, and uses the new one", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const held = yield* Ref.make(limits(40, 600));
      const asked = yield* Ref.make(0);
      const reading = yield* readFreshKodoLimits({
        read: Ref.get(held),
        refresh: Ref.update(asked, (count) => count + 1).pipe(
          Effect.andThen(Ref.set(held, limits(96, 0))),
        ),
      });
      expect(reading.state).toBe("ok");
      expect(percentOf(reading)).toBe(96);
      expect(yield* Ref.get(asked)).toBe(1);
    }),
  );

  it.effect("is 'could not check' when the provider does not give a reading newer than the bound", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const stale = yield* readFreshKodoLimits({
        read: Effect.succeed(limits(40, 600)),
        refresh: Effect.void,
      });
      expect(stale.state).toBe("stale");
      const unrefreshable = yield* readFreshKodoLimits({ read: Effect.succeed(limits(40, 600)) });
      expect(unrefreshable.state).toBe("stale");
    }),
  );

  it.effect("goes on with what it has when the refresh fails", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const reading = yield* readFreshKodoLimits({
        read: Effect.succeed(limits(40, 600)),
        refresh: Effect.fail({ _tag: "ProbeFailed" }),
      });
      expect(reading.state).toBe("stale");
    }),
  );

  it.effect("does not wait on a refresh that never answers beyond its bound", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const fiber = yield* readFreshKodoLimits({
        read: Effect.succeed(limits(40, 600)),
        refresh: Effect.never,
      }).pipe(Effect.forkChild({ startImmediately: true }));
      yield* TestClock.adjust(Duration.millis(KODO_LIMIT_REFRESH_WAIT_MS));
      expect((yield* Fiber.join(fiber)).state).toBe("stale");
    }),
  );

  it.effect("has nothing to check for a provider that reports no limit windows", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const reading = yield* readFreshKodoLimits({ read: Effect.undefined });
      expect(reading.state).toBe("missing");
    }),
  );
});
