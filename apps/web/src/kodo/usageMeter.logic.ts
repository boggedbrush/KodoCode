import type { ServerProvider, ServerProviderUsageLimits } from "@t3tools/contracts";
import {
  collectLimitAccounts,
  collectLimitPools,
  displayLimitWindows,
  formatDuration,
  type LimitPool,
  type LimitPoolWindow,
} from "@t3tools/shared/usageLimits";

/** Used share at which a window starts to read as "getting close". Matches the thread details card. */
export const KODO_USAGE_WARN_USED_PERCENT = 80;
export const KODO_USAGE_CRITICAL_USED_PERCENT = 90;
/** Provider health refreshes about once a minute; a reading this old means refreshes are failing. */
export const KODO_USAGE_STALE_AFTER_MS = 30 * 60_000;
/** The sidebar chip stays small; the rest is one click away on Usage. */
export const KODO_USAGE_METER_MAX_ENTRIES = 2;

export type KodoUsageLevel = "ok" | "warning" | "critical" | "exhausted";

export function kodoUsageLevel(usedPercent: number): KodoUsageLevel {
  if (usedPercent >= 100) return "exhausted";
  if (usedPercent >= KODO_USAGE_CRITICAL_USED_PERCENT) return "critical";
  if (usedPercent >= KODO_USAGE_WARN_USED_PERCENT) return "warning";
  return "ok";
}

const LEVEL_RANK: Record<KodoUsageLevel, number> = { ok: 0, warning: 1, critical: 2, exhausted: 3 };

export interface KodoUsageReading {
  readonly label: string;
  readonly usedPercent: number;
  readonly remainingPercent: number;
  readonly level: KodoUsageLevel;
  /** Next reset as epoch millis, when the provider reports one that is still ahead. */
  readonly resetsAtMs: number | null;
  readonly stale: boolean;
}

interface WindowInput {
  readonly label: string;
  readonly usedPercent: number;
  /** Every reset the window knows about; the soonest still-future one is reported. */
  readonly resetsAtMs: readonly number[];
}

function readWindows(
  windows: readonly WindowInput[],
  stale: boolean,
  now: number,
): KodoUsageReading | null {
  let worst: KodoUsageReading | null = null;
  for (const window of windows) {
    const resets = window.resetsAtMs.filter((at) => Number.isFinite(at));
    // A reset that already passed means the stored percentage describes the previous window.
    if (resets.length > 0 && resets.every((at) => at <= now)) continue;
    const usedPercent = Math.max(0, Math.min(100, window.usedPercent));
    const next = resets.filter((at) => at > now).toSorted((a, b) => a - b)[0] ?? null;
    const reading: KodoUsageReading = {
      label: window.label,
      usedPercent,
      remainingPercent: Math.round(100 - usedPercent),
      level: kodoUsageLevel(usedPercent),
      resetsAtMs: next,
      stale,
    };
    if (
      worst === null ||
      reading.usedPercent > worst.usedPercent ||
      (reading.usedPercent === worst.usedPercent &&
        (reading.resetsAtMs ?? Infinity) < (worst.resetsAtMs ?? Infinity))
    ) {
      worst = reading;
    }
  }
  return worst;
}

function parseMs(iso: string | undefined): number {
  return iso === undefined ? Number.NaN : Date.parse(iso);
}

export function kodoUsageIsStale(checkedAt: string, now: number): boolean {
  const at = Date.parse(checkedAt);
  return !Number.isFinite(at) || now - at > KODO_USAGE_STALE_AFTER_MS;
}

/** The tightest live window of one provider instance, or null when it reports no limits. */
export function summarizeProviderLimits(
  limits: ServerProviderUsageLimits | undefined,
  now: number,
): KodoUsageReading | null {
  if (!limits || limits.unavailable?.reason === "unsupported") return null;
  return readWindows(
    limits.windows.map((window) => ({
      label: window.label,
      usedPercent: window.usedPercent,
      resetsAtMs: [parseMs(window.resetsAt)],
    })),
    kodoUsageIsStale(limits.checkedAt, now) || limits.unavailable?.reason === "probeFailed",
    now,
  );
}

function poolWindowInput(window: LimitPoolWindow): WindowInput {
  return {
    label: window.label,
    // The Limits cards round the pooled remainder, so derive from it to print the same number.
    usedPercent: 100 - window.remainingPercent,
    resetsAtMs: window.resets.map((reset) => reset.at),
  };
}

export interface KodoUsageMeterEntry extends KodoUsageReading {
  readonly key: string;
  readonly providerLabel: string;
  /** Number of accounts pooled behind the reading. */
  readonly accountCount: number;
}

/** One entry per provider: its tightest window across every account the user has signed in. */
export function summarizePools(
  pools: readonly LimitPool[],
  now: number,
  providerLabel: (driver: ServerProvider["driver"]) => string,
): readonly KodoUsageMeterEntry[] {
  const entries: KodoUsageMeterEntry[] = [];
  for (const pool of pools) {
    const newestCheck = Math.max(
      ...pool.accounts.map((account) => parseMs(account.limits.checkedAt)),
    );
    const stale = !Number.isFinite(newestCheck) || now - newestCheck > KODO_USAGE_STALE_AFTER_MS;
    const reading = readWindows(displayLimitWindows(pool).map(poolWindowInput), stale, now);
    if (reading === null) continue;
    entries.push({
      ...reading,
      key: pool.driver,
      providerLabel: providerLabel(pool.driver),
      accountCount: pool.accounts.length,
    });
  }
  return entries;
}

/** What the quiet sidebar meter shows: only windows past the warning line, tightest first. */
export function selectMeterEntries(
  entries: readonly KodoUsageMeterEntry[],
): readonly KodoUsageMeterEntry[] {
  return entries
    .filter((entry) => entry.level !== "ok")
    .toSorted(
      (a, b) =>
        LEVEL_RANK[b.level] - LEVEL_RANK[a.level] ||
        b.usedPercent - a.usedPercent ||
        a.key.localeCompare(b.key),
    );
}

export function collectKodoUsageMeterEntries(
  presentations: Parameters<typeof collectLimitAccounts>[0],
  now: number,
  providerLabel: (driver: ServerProvider["driver"]) => string,
): readonly KodoUsageMeterEntry[] {
  return selectMeterEntries(
    summarizePools(collectLimitPools(collectLimitAccounts(presentations), now), now, providerLabel),
  );
}

/** "resets in 2h 14m" from epoch millis, so it reads the same in every time zone. */
export function formatKodoResetsIn(resetsAtMs: number | null, now: number): string | null {
  if (resetsAtMs === null) return null;
  if (resetsAtMs <= now) return "resets now";
  if (resetsAtMs - now < 60_000) return "resets in under a minute";
  return `resets in ${formatDuration(resetsAtMs - now)}`;
}

export type KodoPickerUsageHint = {
  readonly level: Exclude<KodoUsageLevel, "ok">;
  readonly text: string;
} | null;

/** The model picker's provider hint: only exhausted or nearly exhausted, never for stale readings of "ok". */
export function kodoPickerUsageHint(
  limits: ServerProviderUsageLimits | undefined,
  now: number,
): KodoPickerUsageHint {
  const reading = summarizeProviderLimits(limits, now);
  if (reading === null || reading.level === "ok" || reading.level === "warning") return null;
  const resets = formatKodoResetsIn(reading.resetsAtMs, now);
  const head =
    reading.level === "exhausted"
      ? `${reading.label} limit reached`
      : `${reading.label}: ${reading.remainingPercent}% left`;
  return {
    level: reading.level,
    text: `${head}${resets ? ` · ${resets}` : ""}${reading.stale ? " · last reading may be out of date" : ""}`,
  };
}

/** Providers with no subscription limits to show, so a gap is explicit. A driver a hub reports is covered. */
export function providersWithoutLimitData(
  providers: readonly ServerProvider[],
  coveredDrivers: ReadonlySet<ServerProvider["driver"]> = new Set(),
): readonly string[] {
  const names = new Set<string>();
  for (const provider of providers) {
    if (!provider.enabled || !provider.installed || coveredDrivers.has(provider.driver)) continue;
    if (provider.usageLimits !== undefined && provider.usageLimits.unavailable === undefined) {
      continue;
    }
    if (provider.usageLimits?.unavailable?.reason === "probeFailed") continue;
    names.add(provider.displayName?.trim() || String(provider.driver));
  }
  return [...names].toSorted((a, b) => a.localeCompare(b));
}

export const KODO_USAGE_SLASH_COMMAND = "usage";
export type KodoUsageSlashCommand = typeof KODO_USAGE_SLASH_COMMAND;

export const KODO_USAGE_SLASH_COMMAND_ITEM = {
  command: KODO_USAGE_SLASH_COMMAND,
  label: `/${KODO_USAGE_SLASH_COMMAND}`,
  description: "Open usage and subscription limits",
} as const;

export function isKodoUsageSlashCommand(command: string): command is KodoUsageSlashCommand {
  return command === KODO_USAGE_SLASH_COMMAND;
}

/** `/usage` alone in the prompt; `/usage-limits` stays upstream's per-provider panel. */
export function parseKodoUsageSlashCommand(prompt: string): boolean {
  return /^\s*\/usage\s*$/i.test(prompt);
}
