import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_KODO_MODE_MODELS,
  ProviderInstanceId,
  ThreadId,
  type KodoDelegationUsage,
  type KodoModeModels,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";

import {
  kodoLeadInstructionsWithUsage,
  kodoLeadProviderInstanceIds,
  makeKodoLeadUsage,
  type KodoLeadUsageDeps,
  type KodoUsageThread,
} from "./leadUsage.ts";

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
const at = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));
const LEAD = ThreadId.make("lead");

const model = (instanceId: string) => ({
  instanceId: ProviderInstanceId.make(instanceId),
  model: "m",
});
const thread = (over: Partial<KodoUsageThread> = {}): KodoUsageThread => ({
  id: LEAD,
  modelSelection: model("claude"),
  interactionMode: "code",
  kodoLead: { kind: "sub-agents" },
  ...over,
});

const provider = (
  instanceId: string,
  usedPercent: number,
  checkedAt: number,
  resetsAt = NOW + 130 * 60_000,
) => ({
  instanceId: ProviderInstanceId.make(instanceId),
  driver: instanceId as never,
  displayName: instanceId === "claude" ? "Claude" : "Codex",
  usageLimits: {
    checkedAt: at(checkedAt),
    windows: [
      {
        id: "5h",
        kind: "session",
        label: "5 hour",
        usedPercent,
        windowDurationMins: 300,
        resetsAt: at(resetsAt),
      },
    ],
  } as never,
});

const usage: KodoDelegationUsage = {
  threadId: LEAD,
  lead: { tokens: 1000, costUsd: 0.5, complete: true },
  workers: { tokens: 3000, costUsd: 0.75, complete: true },
  workerCount: 2,
  unreportedWorkers: 0,
};

const modeModels = (over: Partial<KodoModeModels> = {}): KodoModeModels => ({
  ...DEFAULT_KODO_MODE_MODELS,
  ...over,
});

const setup = (over: Partial<KodoLeadUsageDeps> = {}) =>
  Effect.gen(function* () {
    const refreshes = yield* Ref.make<ReadonlyArray<string>>([]);
    const deps: KodoLeadUsageDeps = {
      providers: Effect.succeed([provider("claude", 62, NOW - 30_000)]),
      settings: Effect.succeed({ modeModels: modeModels(), stopAtPercent: 90 }),
      spend: () => Effect.succeed(usage),
      getThread: () => Effect.succeed(thread()),
      limitSource: (instanceId) => ({
        read: Effect.succeed(provider(instanceId, 70, NOW - 60_000).usageLimits),
        refresh: Ref.update(refreshes, (all) => [...all, instanceId]),
      }),
      ...over,
    };
    yield* TestClock.setTime(NOW);
    return { service: makeKodoLeadUsage(deps), refreshes };
  });

describe("which providers a lead's usage covers", () => {
  it("is the lead's own and each worker mode's configured provider, once each", () => {
    const slots = modeModels({ review: model("codex"), code: model("claude") });
    expect(kodoLeadProviderInstanceIds(thread(), slots)).toEqual(["claude", "codex"]);
    expect(kodoLeadProviderInstanceIds(thread({ interactionMode: "ask" }), slots)).toEqual([
      "claude",
    ]);
    expect(kodoLeadProviderInstanceIds(thread({ kodoLead: { kind: "swarm" } }), slots)).toEqual([
      "claude",
      "codex",
    ]);
  });
});

describe("the usage line a lead is given", () => {
  it.effect("reads the last reading and never asks a provider to read again", () =>
    Effect.gen(function* () {
      const { service, refreshes } = yield* setup();
      const line = yield* service.line(thread());
      expect(line).toContain("Claude: 5-hour 62% (resets in 2h 10m)");
      expect(line).toContain("4,000 tokens");
      expect(yield* Ref.get(refreshes)).toEqual([]);
    }),
  );

  it.effect(
    "shows a reading older than the gate's rule with its age, and past 15 minutes as unknown",
    () =>
      Effect.gen(function* () {
        const fresh = yield* setup();
        expect(yield* fresh.service.line(thread())).not.toContain("as of");
        const aged = yield* setup({
          providers: Effect.succeed([provider("claude", 62, NOW - 4 * 60_000 - 20_000)]),
        });
        expect(yield* aged.service.line(thread())).toContain(
          "Claude: 5-hour 62% (resets in 2h 10m) as of 4m ago",
        );
        const old = yield* setup({
          providers: Effect.succeed([provider("claude", 99, NOW - 16 * 60_000)]),
        });
        const line = yield* old.service.line(thread());
        expect(line).toContain("Claude: unknown");
        expect(line).not.toContain("99%");
      }),
  );

  it.effect("says unknown for a reading whose window has reset since", () =>
    Effect.gen(function* () {
      const passed = provider("claude", 99, NOW - 5 * 60_000, NOW - 1_000);
      const { service } = yield* setup({ providers: Effect.succeed([passed]) });
      const line = yield* service.line(thread());
      expect(line).toContain("Claude: unknown");
      expect(line).not.toContain("99%");
    }),
  );

  it.effect("is nothing for a thread that does not lead", () =>
    Effect.gen(function* () {
      const { service } = yield* setup();
      expect(yield* service.line(thread({ kodoLead: null }))).toBeUndefined();
    }),
  );

  it.effect("is left out, never an error, when the settings or the spend cannot be read", () =>
    Effect.gen(function* () {
      const settingsFail = yield* setup({ settings: Effect.fail({ _tag: "SettingsError" }) });
      expect(yield* settingsFail.service.line(thread())).toBeUndefined();
      const spendDies = yield* setup({ spend: () => Effect.die("boom") });
      expect(yield* spendDies.service.line(thread())).toBeUndefined();
    }),
  );

  it.effect("delivers with the lead's instructions only where the service is provided", () =>
    Effect.gen(function* () {
      const { service } = yield* setup();
      const without = yield* kodoLeadInstructionsWithUsage(Option.none(), thread());
      const withLine = yield* kodoLeadInstructionsWithUsage(Option.some(service), thread());
      expect(without).toContain("<kodo_sub_agents>");
      expect(without).not.toContain("Usage limits (last reading)");
      expect(withLine?.startsWith(without ?? "")).toBe(true);
      expect(withLine).toContain("Usage limits (last reading)");
      expect(
        yield* kodoLeadInstructionsWithUsage(Option.some(service), thread({ kodoLead: null })),
      ).toBeUndefined();
    }),
  );
});

describe("the usage status behind the tool", () => {
  it.effect("asks each provider to read again, then reports its own age and the spend", () =>
    Effect.gen(function* () {
      const { service, refreshes } = yield* setup({
        settings: Effect.succeed({
          modeModels: modeModels({ review: model("codex") }),
          stopAtPercent: 85,
        }),
      });
      const status = yield* service.status(LEAD);
      expect((yield* Ref.get(refreshes)).toSorted()).toEqual(["claude", "codex"]);
      expect(status?.stopAtPercent).toBe(85);
      expect(status?.providers.map((entry) => entry.state)).toEqual(["ok", "ok"]);
      expect(status?.spend).toMatchObject({ tokens: 4000, workers: 2 });
    }),
  );

  it.effect("is nothing for a thread that is gone", () =>
    Effect.gen(function* () {
      const { service } = yield* setup({ getThread: () => Effect.succeed(null) });
      expect(yield* service.status(LEAD)).toBeUndefined();
    }),
  );
});
