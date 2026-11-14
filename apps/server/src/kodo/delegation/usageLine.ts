// The usage a lead is told, as pure text and data: the line that rides with each of its messages and
// the detail `t3_usage_status` returns. Both read the same readings, so they never disagree. A reading
// that is missing or older than the limit gate's freshness bound is "unknown", never a number.
import type { KodoDelegationUsage } from "@t3tools/contracts";
import { formatKodoTokens, formatKodoUsd } from "@t3tools/shared/kodoLoopView";
import {
  formatKodoMinutes,
  type KodoLimitReading,
  type KodoLimitWindow,
} from "@t3tools/shared/kodoLoopLimits";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

/** The most windows one provider shows in the line: the fullest, which are the ones that stop work. */
const MAX_WINDOWS_PER_PROVIDER = 2;

export interface KodoUsageProviderReading {
  readonly instanceId: string;
  readonly name: string;
  readonly reading: KodoLimitReading;
}

export interface KodoUsageSpend {
  readonly tokens: number;
  readonly costUsd?: number;
  /** False when a turn reported nothing, a worker was left out, or a model has no price: a floor. */
  readonly complete: boolean;
  readonly leadTokens: number;
  readonly workerTokens: number;
  readonly workers: number;
}

/** "2h 10m", "12m", "3d": how long until a reset, or undefined when it is unknown or already past. */
export function kodoResetsIn(resetsAt: string | undefined, nowMs: number): string | undefined {
  const at = resetsAt === undefined ? Number.NaN : Date.parse(resetsAt);
  if (!Number.isFinite(at) || at <= nowMs) return undefined;
  return formatKodoMinutes(Math.max(1, Math.round((at - nowMs) / 60_000)));
}

/** "14:30 UTC": the reset as a clock time, for the refusal a person may read. */
export function kodoResetClock(resetsAt: string | undefined): string | undefined {
  const at = resetsAt === undefined ? Number.NaN : Date.parse(resetsAt);
  return Number.isFinite(at)
    ? `${DateTime.formatIso(DateTime.makeUnsafe(at)).slice(11, 16)} UTC`
    : undefined;
}

/** The lead's and its workers' spend as one figure; undefined when nothing reported. */
export function kodoCombinedSpend(
  usage: Pick<KodoDelegationUsage, "lead" | "workers" | "workerCount" | "unreportedWorkers">,
): KodoUsageSpend | undefined {
  const sides = [usage.lead, usage.workers].flatMap((side) => (side === undefined ? [] : [side]));
  if (sides.length === 0) return undefined;
  const priced = sides.filter((side) => side.costUsd !== undefined);
  return {
    tokens: sides.reduce((sum, side) => sum + side.tokens, 0),
    ...(priced.length === 0
      ? {}
      : { costUsd: priced.reduce((sum, side) => sum + (side.costUsd ?? 0), 0) }),
    // A side with tokens but no price leaves the cost short of the truth.
    complete:
      sides.every((side) => side.complete) &&
      priced.length === sides.length &&
      usage.unreportedWorkers === 0,
    leadTokens: usage.lead?.tokens ?? 0,
    workerTokens: usage.workers?.tokens ?? 0,
    workers: usage.workerCount,
  };
}

const windowText = (window: KodoLimitWindow, nowMs: number) => {
  const resets = kodoResetsIn(window.resetsAt, nowMs);
  return `${window.name} ${Math.round(window.usedPercent)}%${resets === undefined ? "" : ` (resets in ${resets})`}`;
};

const providerText = (provider: KodoUsageProviderReading, nowMs: number) => {
  if (provider.reading.state !== "ok") return `${provider.name}: unknown`;
  const fullest = provider.reading.windows
    .toSorted((a, b) => b.usedPercent - a.usedPercent)
    .slice(0, MAX_WINDOWS_PER_PROVIDER);
  return `${provider.name}: ${fullest.map((window) => windowText(window, nowMs)).join(", ")}`;
};

const spendText = (spend: KodoUsageSpend | undefined) => {
  if (spend === undefined) return "none reported yet";
  const floor = spend.complete ? "" : "at least ";
  const cost =
    spend.costUsd === undefined
      ? "no price known"
      : `about ${floor}${formatKodoUsd(spend.costUsd)}`;
  return `${floor}${formatKodoTokens(spend.tokens)} tokens, ${cost}`;
};

/** The few dozen tokens that ride with each lead message. Rules for acting on it are in the lead's instructions. */
export function formatKodoUsageLine(input: {
  readonly providers: ReadonlyArray<KodoUsageProviderReading>;
  readonly nowMs: number;
  readonly spend: KodoUsageSpend | undefined;
  readonly stopAtPercent: number;
}): string {
  const limits =
    input.providers.length === 0
      ? "unknown"
      : input.providers.map((provider) => providerText(provider, input.nowMs)).join("; ");
  return `<kodo_usage>Usage limits (last reading): ${limits}. Spent in this conversation, you and workers: ${spendText(input.spend)}. Delegation is refused at ${input.stopAtPercent}%.</kodo_usage>`;
}

const Window = Schema.Struct({
  name: Schema.String,
  usedPercent: Schema.Number,
  resetsAt: Schema.optional(Schema.String),
  resetsInMinutes: Schema.optional(Schema.Number),
});

/** What `t3_usage_status` returns. */
export const KodoUsageStatus = Schema.Struct({
  providers: Schema.Array(
    Schema.Struct({
      instanceId: Schema.String,
      name: Schema.String,
      state: Schema.Literals(["ok", "unknown"]),
      /** Seconds since the provider reported these windows; absent when unknown. */
      readAgeSeconds: Schema.optional(Schema.Number),
      windows: Schema.Array(Window),
    }),
  ),
  stopAtPercent: Schema.Number,
  spend: Schema.optional(
    Schema.Struct({
      tokens: Schema.Number,
      costUsd: Schema.optional(Schema.Number),
      complete: Schema.Boolean,
      leadTokens: Schema.Number,
      workerTokens: Schema.Number,
      workers: Schema.Number,
    }),
  ),
  note: Schema.String,
});
export type KodoUsageStatus = typeof KodoUsageStatus.Type;

export function kodoUsageStatus(input: {
  readonly providers: ReadonlyArray<KodoUsageProviderReading>;
  readonly nowMs: number;
  readonly spend: KodoUsageSpend | undefined;
  readonly stopAtPercent: number;
}): KodoUsageStatus {
  return {
    providers: input.providers.map((provider) =>
      provider.reading.state === "ok"
        ? {
            instanceId: provider.instanceId,
            name: provider.name,
            state: "ok" as const,
            readAgeSeconds: Math.max(
              0,
              Math.round((input.nowMs - provider.reading.checkedAtMs) / 1000),
            ),
            windows: provider.reading.windows.map((window) => ({
              name: window.name,
              usedPercent: Math.round(window.usedPercent),
              ...(window.resetsAt === undefined ? {} : { resetsAt: window.resetsAt }),
              ...(kodoResetsIn(window.resetsAt, input.nowMs) === undefined
                ? {}
                : {
                    resetsInMinutes: Math.round(
                      (Date.parse(window.resetsAt ?? "") - input.nowMs) / 60_000,
                    ),
                  }),
            })),
          }
        : {
            instanceId: provider.instanceId,
            name: provider.name,
            state: "unknown" as const,
            windows: [],
          },
    ),
    stopAtPercent: input.stopAtPercent,
    ...(input.spend === undefined ? {} : { spend: input.spend }),
    note: `Delegation is refused when a provider's fullest window is at or above ${input.stopAtPercent}%. "unknown" means the provider reports no limit or the reading is too old to trust.`,
  };
}
