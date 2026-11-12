// Reads a provider's usage-limit windows for the loop's budget gate and its per-stage record. Pure:
// the caller passes the clock. A reading that is missing or out of date never stops a loop, but it
// is said so, because a limit setting that cannot see the limit is not protecting anything.
import type { ServerProviderUsageLimits } from "@t3tools/contracts";

/** Provider health refreshes about once a minute; a reading this old means refreshes are failing. */
const STALE_AFTER_MS = 30 * 60_000;

export interface KodoLimitWindow {
  /** The provider's own window id, stable across readings. */
  readonly id: string;
  /** How the window reads in a sentence: "5-hour", "weekly", or the provider's label. */
  readonly name: string;
  readonly usedPercent: number;
}

export type KodoLimitReading =
  /** At least one live window. */
  | { readonly state: "ok"; readonly windows: ReadonlyArray<KodoLimitWindow> }
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
  if (mins === WEEK_MINS) return "weekly";
  if (mins !== undefined && mins > 0 && mins % HOUR_MINS === 0 && mins <= 48 * HOUR_MINS) {
    return `${mins / HOUR_MINS}-hour`;
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
    nowMs - checkedAt > STALE_AFTER_MS ||
    limits.unavailable?.reason === "probeFailed";
  // A reset that already passed means the stored percentage describes the previous window.
  const live = limits.windows.filter((window) => {
    const resetsAt = window.resetsAt === undefined ? Number.NaN : Date.parse(window.resetsAt);
    return !Number.isFinite(resetsAt) || resetsAt > nowMs;
  });
  if (old || live.length === 0) return { state: "stale" };
  return {
    state: "ok",
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
 */
export function observedKodoLimitChange(
  before: KodoLimitReading,
  after: KodoLimitReading,
): ReadonlyArray<{ readonly window: string; readonly before: number; readonly after: number }> {
  if (before.state !== "ok" || after.state !== "ok") return [];
  return after.windows.flatMap((window) => {
    const earlier = before.windows.find((candidate) => candidate.id === window.id);
    return earlier === undefined
      ? []
      : [{ window: window.name, before: earlier.usedPercent, after: window.usedPercent }];
  });
}
