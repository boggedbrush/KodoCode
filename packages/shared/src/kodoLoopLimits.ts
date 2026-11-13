// Reads a provider's usage-limit windows for the loop's budget gate and its per-stage record. Pure:
// the caller passes the clock. A reading that is missing or out of date never stops a loop, but it
// is said so, because a limit setting that cannot see the limit is not protecting anything. Any of
// a provider's windows can stop a loop: the gate takes the fullest.
import type { ServerProviderUsageLimits } from "@t3tools/contracts";

/**
 * The oldest a reading may be for the gate to act on it. Provider health refreshes every five
 * minutes, and only while a client is watching, so the gate asks the provider for a fresh reading
 * first; a reading older than this after that ask is "could not check", not a number to trust.
 */
export const KODO_LIMIT_MAX_AGE_MS = 2 * 60_000;

export interface KodoLimitWindow {
  /** The provider's own window id, stable across readings. */
  readonly id: string;
  /** How the window reads in a sentence: "5-hour", "weekly", or the provider's label. */
  readonly name: string;
  readonly usedPercent: number;
}

export type KodoLimitReading =
  /** At least one live window, read at `checkedAtMs` (within the freshness bound when it was taken). */
  | {
      readonly state: "ok";
      readonly checkedAtMs: number;
      readonly windows: ReadonlyArray<KodoLimitWindow>;
    }
  /** Windows exist but the reading is old, a probe failed, or every window has already reset. */
  | { readonly state: "stale" }
  /** The provider reports no limit windows (or none are known). */
  | { readonly state: "missing" };

const HOUR_MINS = 60;
const WEEK_MINS = 7 * 24 * HOUR_MINS;

function windowName(window: {
  readonly label: string;
  readonly windowDurationMins?: number | undefined;
}) {
  const mins = window.windowDurationMins;
  // A scoped window ("Weekly · Opus") keeps its scope, so two weekly windows are never both "weekly".
  const scope = window.label.split(" · ")[1]?.trim();
  const suffix = scope === undefined || scope.length === 0 ? "" : ` ${scope}`;
  if (mins === WEEK_MINS) return `weekly${suffix}`;
  if (mins !== undefined && mins > 0 && mins % HOUR_MINS === 0 && mins <= 48 * HOUR_MINS) {
    return `${mins / HOUR_MINS}-hour${suffix}`;
  }
  return window.label;
}

export function readKodoLimitWindows(
  limits: ServerProviderUsageLimits | undefined,
  nowMs: number,
): KodoLimitReading {
  if (limits === undefined || limits.unavailable?.reason === "unsupported") {
    return { state: "missing" };
  }
  if (limits.windows.length === 0) {
    return limits.unavailable?.reason === "probeFailed" ? { state: "stale" } : { state: "missing" };
  }
  const checkedAt = Date.parse(limits.checkedAt);
  const old =
    !Number.isFinite(checkedAt) ||
    nowMs - checkedAt > KODO_LIMIT_MAX_AGE_MS ||
    limits.unavailable?.reason === "probeFailed";
  // A reset that already passed means the stored percentage describes the previous window.
  const live = limits.windows.filter((window) => {
    const resetsAt = window.resetsAt === undefined ? Number.NaN : Date.parse(window.resetsAt);
    return !Number.isFinite(resetsAt) || resetsAt > nowMs;
  });
  if (old || live.length === 0) return { state: "stale" };
  return {
    state: "ok",
    checkedAtMs: checkedAt,
    windows: live.map((window) => ({
      id: window.id,
      name: windowName(window),
      usedPercent: Math.max(0, Math.min(100, window.usedPercent)),
    })),
  };
}

/** The fullest window of a reading, or null when there is none. */
export function fullestKodoLimitWindow(reading: KodoLimitReading): KodoLimitWindow | null {
  if (reading.state !== "ok") return null;
  return reading.windows.reduce<KodoLimitWindow | null>(
    (fullest, window) =>
      fullest === null || window.usedPercent > fullest.usedPercent ? window : fullest,
    null,
  );
}

/**
 * Each window the provider reported both before and after a stage, as the change observed over that
 * time. Other work on the same account moves the same windows, so this is never a cost of the stage.
 * Two readings taken at the same moment are one reading twice: they say nothing about the stage.
 */
export function observedKodoLimitChange(
  before: KodoLimitReading,
  after: KodoLimitReading,
): ReadonlyArray<{ readonly window: string; readonly before: number; readonly after: number }> {
  if (before.state !== "ok" || after.state !== "ok") return [];
  if (after.checkedAtMs <= before.checkedAtMs) return [];
  return after.windows.flatMap((window) => {
    const earlier = before.windows.find((candidate) => candidate.id === window.id);
    return earlier === undefined
      ? []
      : [{ window: window.name, before: earlier.usedPercent, after: window.usedPercent }];
  });
}
