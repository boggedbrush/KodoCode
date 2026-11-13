import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { TestClock } from "effect/testing";

import { kodoGuardWorkerLimit, type KodoWorkerLimitDeps } from "./workerLimitGate.ts";

const NOW = Date.UTC(2026, 10, 13, 12, 0, 0);

const provider = (
  usedPercent: number,
  over: { checkedAt?: number; unavailable?: boolean } = {},
) => ({
  instanceId: "codex" as never,
  driver: "codex" as never,
  displayName: "Codex",
  usageLimits: {
    checkedAt: DateTime.formatIso(DateTime.makeUnsafe(over.checkedAt ?? NOW)),
    windows: [{ id: "5h", label: "5 hour", usedPercent, windowDurationMins: 300 }],
  } as never,
});

const deps = (
  over: Partial<KodoWorkerLimitDeps> & { providers?: KodoWorkerLimitDeps["providers"] },
): KodoWorkerLimitDeps => ({
  providers: Effect.succeed([provider(50)]),
  stopAtPercent: Effect.succeed(90),
  ...over,
});

const run = (d: KodoWorkerLimitDeps) =>
  TestClock.setTime(NOW).pipe(
    Effect.andThen(kodoGuardWorkerLimit(d, "codex")),
    Effect.map(() => "allowed" as const),
    Effect.catch((error) => Effect.succeed(error.message)),
  );

describe("the usage-limit gate before a worker starts", () => {
  it.effect("allows a provider under the threshold", () =>
    Effect.gen(function* () {
      expect(yield* run(deps({}))).toBe("allowed");
    }),
  );

  it.effect("refuses at the loop's threshold with a message the lead can relay", () =>
    Effect.gen(function* () {
      const message = yield* run(deps({ providers: Effect.succeed([provider(92)]) }));
      expect(message).toMatch(/usage limit of Codex is at 92%/);
      expect(message).toMatch(/No worker was started/);
    }),
  );

  it.effect("uses the person's setting", () =>
    Effect.gen(function* () {
      expect(yield* run(deps({ stopAtPercent: Effect.succeed(40) }))).toMatch(/at 50%/);
    }),
  );

  it.effect("reads the instance's own snapshot when the server has one", () =>
    Effect.gen(function* () {
      const message = yield* run(
        deps({ readLimits: () => Effect.succeed(provider(97).usageLimits) }),
      );
      expect(message).toMatch(/at 97%/);
    }),
  );

  it.effect("refuses on a stale reading, and allows a provider that reports no windows", () =>
    Effect.gen(function* () {
      const stale = provider(99, { checkedAt: NOW - 60 * 60_000 });
      expect(yield* run(deps({ providers: Effect.succeed([stale]) }))).toMatch(
        /could not be read, so no worker was started/,
      );
      const none = { ...provider(0), usageLimits: undefined };
      expect(yield* run(deps({ providers: Effect.succeed([none as never]) }))).toBe("allowed");
    }),
  );

  it.effect(
    "refuses when the gate itself fails: a limit that cannot be checked is not skipped",
    () =>
      Effect.gen(function* () {
        const broken = yield* run(deps({ providers: Effect.fail({ _tag: "ProviderListError" }) }));
        expect(broken).toMatch(/could not be read, so no worker was started/);
        const settingsBroken = yield* run(
          deps({ stopAtPercent: Effect.fail({ _tag: "SettingsError" }) }),
        );
        expect(settingsBroken).toMatch(/could not be read/);
      }),
  );
});
