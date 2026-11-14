// What a lead is told about usage. `line` rides with each message and reads only what the server
// holds, never a provider; `status` (behind `t3_usage_status`) asks providers to read again. The limit
// rules, pricing and spend are the gate's, the loop's and the delegation bar's.
import {
  type KodoDelegationUsage,
  type KodoLead,
  type KodoModeModels,
  type OrchestrationV2DomainEvent,
  type ServerProvider,
  type ThreadId,
} from "@t3tools/contracts";
import { readKodoLimitWindows, type KodoLimitReading } from "@t3tools/shared/kodoLoopLimits";
import { kodoThreadOwnModel, type KodoModeModelThread } from "@t3tools/shared/kodoModeModel";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProviderInstanceRegistry from "../../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as UsageService from "../../usage/UsageService.ts";
import { type KodoLimitSource, readFreshKodoLimits } from "../loop/limitReading.ts";
import { makeKodoLeadSpendCache } from "./leadSpendCache.ts";
import { kodoLeadInstructionsFor } from "./leadInstructions.ts";
import { kodoWorkerInstanceIds } from "./leadDelegation.ts";
import { makeKodoLimitSources } from "./limitSources.ts";
import {
  formatKodoUsageLine,
  KODO_USAGE_LINE_MAX_AGE_MS,
  kodoCombinedSpend,
  kodoUsageStatus,
  type KodoUsageProviderReading,
  type KodoUsageStatus,
} from "./usageLine.ts";
import { makeKodoDelegationUsageReader } from "./usageReader.ts";

/** What the usage of a lead is worked out from: a thread shell has all of it. */
export type KodoUsageThread = KodoModeModelThread & {
  readonly id: ThreadId;
  readonly kodoLead?: Pick<KodoLead, "kind"> | null | undefined;
  readonly interactionMode: unknown;
};

type ProviderRow = Pick<ServerProvider, "instanceId" | "driver" | "displayName" | "usageLimits">;

export interface KodoLeadUsageDeps {
  readonly providers: Effect.Effect<ReadonlyArray<ProviderRow>>;
  readonly settings: Effect.Effect<
    { readonly modeModels: KodoModeModels; readonly stopAtPercent: number },
    { readonly _tag: string }
  >;
  /** The lead's spend. The line asks on the path to every message, so this one must be cheap. */
  readonly spend: (threadId: ThreadId) => Effect.Effect<KodoDelegationUsage | undefined>;
  /** Lets the spend's holder see what changed it. Absent: nothing is held. */
  readonly noteEvent?: ((event: OrchestrationV2DomainEvent) => Effect.Effect<void>) | undefined;
  readonly getThread: (threadId: ThreadId) => Effect.Effect<KodoUsageThread | null>;
  /** A provider instance's limits, asked to read again. Absent: the provider list's reading only. */
  readonly limitSource?: ((instanceId: string) => KodoLimitSource) | undefined;
}

/**
 * Every provider the lead and its workers can run on: the lead's own model, and the model each
 * worker mode is set to. The Orchestrator's workers run in projects the person names, in Code or
 * Review mode; a sub-agents lead's depend on its mode.
 */
export function kodoLeadProviderInstanceIds(
  thread: KodoUsageThread,
  modeModels: KodoModeModels,
): ReadonlyArray<string> {
  const own = kodoThreadOwnModel(thread).instanceId;
  const modes =
    thread.kodoLead?.kind === "swarm" || thread.interactionMode === "code"
      ? (["code", "review"] as const)
      : [thread.interactionMode];
  return [
    ...new Set([
      thread.modelSelection.instanceId,
      own,
      ...modes.flatMap((mode) => kodoWorkerInstanceIds({ modeModels, mode, inherited: own })),
    ]),
  ];
}

const providerName = (instanceId: string, providers: ReadonlyArray<ProviderRow>) => {
  const provider = providers.find((candidate) => candidate.instanceId === instanceId);
  return provider?.displayName ?? provider?.driver ?? instanceId;
};

export const makeKodoLeadUsage = (deps: KodoLeadUsageDeps) => {
  const compute = Effect.fn("KodoLeadUsage.compute")(function* (
    thread: KodoUsageThread,
    fresh: boolean,
  ) {
    const providers = yield* deps.providers;
    const { modeModels, stopAtPercent } = yield* deps.settings;
    const nowMs = yield* Clock.currentTimeMillis;
    const readings = yield* Effect.forEach(
      kodoLeadProviderInstanceIds(thread, modeModels),
      Effect.fn("KodoLeadUsage.reading")(function* (instanceId) {
        const reading: KodoLimitReading =
          fresh && deps.limitSource !== undefined
            ? yield* readFreshKodoLimits(deps.limitSource(instanceId))
            : // The line shows an older reading with its age, so it takes one up to its own bound.
              readKodoLimitWindows(
                providers.find((candidate) => candidate.instanceId === instanceId)?.usageLimits,
                nowMs,
                KODO_USAGE_LINE_MAX_AGE_MS,
              );
        return {
          instanceId,
          name: providerName(instanceId, providers),
          reading,
        } satisfies KodoUsageProviderReading;
      }),
      { concurrency: 4 },
    );
    const usage = yield* deps.spend(thread.id);
    return {
      providers: readings,
      // A fresh read can take a few seconds, so the clock is read again for the ages it reports.
      nowMs: fresh ? yield* Clock.currentTimeMillis : nowMs,
      spend: usage === undefined ? undefined : kodoCombinedSpend(usage),
      stopAtPercent,
    };
  });

  return {
    noteEvent: (event: OrchestrationV2DomainEvent): Effect.Effect<void> =>
      deps.noteEvent?.(event) ?? Effect.void,
    /** The line for a lead's message; undefined for a thread that does not lead, or when it cannot be read. */
    line: (thread: KodoUsageThread): Effect.Effect<string | undefined> =>
      kodoLeadInstructionsFor(thread) === undefined
        ? Effect.undefined
        : compute(thread, false).pipe(
            Effect.map(formatKodoUsageLine),
            Effect.catchCause(() => Effect.undefined),
          ),
    /** The detail behind `t3_usage_status`; undefined when the thread is gone. */
    status: (threadId: ThreadId): Effect.Effect<KodoUsageStatus | undefined> =>
      deps.getThread(threadId).pipe(
        Effect.flatMap((thread) =>
          thread === null
            ? Effect.undefined
            : compute(thread, true).pipe(Effect.map(kodoUsageStatus)),
        ),
        Effect.catchCause(() => Effect.undefined),
      ),
  } as const;
};

export class KodoLeadUsage extends Context.Service<
  KodoLeadUsage,
  ReturnType<typeof makeKodoLeadUsage>
>()("t3/kodo/delegation/leadUsage/KodoLeadUsage") {}

const layerWithStore = Layer.effect(
  KodoLeadUsage,
  Effect.gen(function* () {
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const settings = yield* ServerSettings.ServerSettingsService;
    const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
    const usageService = yield* Effect.serviceOption(UsageService.UsageService);
    const instanceRegistry = yield* Effect.serviceOption(
      ProviderInstanceRegistry.ProviderInstanceRegistry,
    );
    const sources = makeKodoLimitSources({ providerRegistry, instanceRegistry });
    const reader = makeKodoDelegationUsageReader({
      orchestrator: projections,
      // Never a fetch: with no rates held the line shows tokens alone.
      price: (model, totals) =>
        Option.isSome(usageService)
          ? usageService.value.priceTokensHeld({ model, totals })
          : Effect.succeed(null),
    });
    const spend = makeKodoLeadSpendCache({
      read: (leadId) =>
        Effect.all([reader.read(leadId), projections.listAppOwnedChildThreadIds(leadId)]).pipe(
          Effect.map(([usage, threadIds]) => ({ usage, threadIds })),
          Effect.orElseSucceed(() => undefined),
        ),
    });
    return makeKodoLeadUsage({
      providers: providerRegistry.getProviders,
      settings: settings.getSettings.pipe(
        Effect.map((value) => ({
          modeModels: value.modeModelSelections,
          stopAtPercent: value.loop.budget.stopAtLimitPercent,
        })),
      ),
      spend: spend.get,
      noteEvent: spend.noteEvent,
      getThread: (threadId) =>
        projections.getThreadShell(threadId).pipe(Effect.orElseSucceed(() => null)),
      ...(sources.readLimits === undefined || sources.refreshLimits === undefined
        ? {}
        : {
            limitSource: (instanceId: string): KodoLimitSource => ({
              read: sources.readLimits(instanceId),
              refresh: sources.refreshLimits(instanceId),
            }),
          }),
    });
  }),
);

// Layers memoize by reference, so this is the projection store the runtime reads, not a second one.
export const layer = layerWithStore.pipe(Layer.provide(ProjectionStore.layer));

/**
 * KODO: the text a lead's model is given with each message: its instructions, then the usage line.
 * `usage` is absent where the server does not provide it (tests, the replay harness): the
 * instructions go alone.
 */
export const kodoLeadInstructionsWithUsage = Effect.fn("KodoLeadUsage.instructions")(function* (
  usage: Option.Option<KodoLeadUsage["Service"]>,
  thread: KodoUsageThread,
) {
  const instructions = kodoLeadInstructionsFor(thread);
  if (instructions === undefined || Option.isNone(usage)) return instructions;
  const line = yield* usage.value.line(thread);
  return line === undefined ? instructions : `${instructions}\n${line}`;
});
