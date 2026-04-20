import type { ServerProviderUsageWindow } from "@t3tools/contracts";

export function clampUsagePercentUsed(percentUsed: number | null): number | null {
  if (percentUsed === null || Number.isNaN(percentUsed)) {
    return null;
  }
  return Math.max(0, Math.min(100, percentUsed));
}

export function toRemainingUsagePercent(percentUsed: number | null): number | null {
  if (percentUsed === null) {
    return null;
  }
  return Math.max(0, Math.min(100, 100 - percentUsed));
}

const FIVE_HOUR_WINDOW_MS = 5 * 60 * 60 * 1000;

function normalizeUsageWindowToken(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ").toLowerCase();
}

function isWeeklyUsageWindow(window: ServerProviderUsageWindow): boolean {
  const token = normalizeUsageWindowToken(`${window.key} ${window.label}`);
  return (
    token.includes("weekly") ||
    token.includes("week") ||
    token.includes("7d") ||
    token.includes("7-day")
  );
}

function isSessionUsageWindow(window: ServerProviderUsageWindow): boolean {
  const token = normalizeUsageWindowToken(`${window.key} ${window.label}`);
  return (
    token.includes("session") ||
    token.includes("5h") ||
    token.includes("5-hour") ||
    token.includes("hour")
  );
}

function takePreferredUsageWindow(input: {
  readonly windows: ReadonlyArray<ServerProviderUsageWindow>;
  readonly usedKeys: Set<string>;
  readonly preferredLabel: string;
  readonly matcher: (window: ServerProviderUsageWindow) => boolean;
}): ServerProviderUsageWindow | null {
  const preferredLabel = normalizeUsageWindowToken(input.preferredLabel);
  const byLabel = input.windows.find((window) => {
    if (input.usedKeys.has(window.key)) {
      return false;
    }
    return normalizeUsageWindowToken(window.label) === preferredLabel;
  });
  if (byLabel) {
    input.usedKeys.add(byLabel.key);
    return byLabel;
  }

  const byMatcher = input.windows.find((window) => {
    if (input.usedKeys.has(window.key)) {
      return false;
    }
    return input.matcher(window);
  });
  if (byMatcher) {
    input.usedKeys.add(byMatcher.key);
    return byMatcher;
  }

  const firstUnclaimed = input.windows.find((window) => !input.usedKeys.has(window.key));
  if (firstUnclaimed) {
    input.usedKeys.add(firstUnclaimed.key);
    return firstUnclaimed;
  }

  return null;
}

export function selectPrimaryUsageWindows(input: {
  readonly windows: ReadonlyArray<ServerProviderUsageWindow>;
  readonly sessionLabel: string;
  readonly weeklyLabel: string;
}): {
  readonly sessionWindow: ServerProviderUsageWindow | null;
  readonly weeklyWindow: ServerProviderUsageWindow | null;
} {
  const usedKeys = new Set<string>();
  const sessionWindow = takePreferredUsageWindow({
    windows: input.windows,
    usedKeys,
    preferredLabel: input.sessionLabel,
    matcher: isSessionUsageWindow,
  });
  const weeklyWindow = takePreferredUsageWindow({
    windows: input.windows,
    usedKeys,
    preferredLabel: input.weeklyLabel,
    matcher: isWeeklyUsageWindow,
  });

  return { sessionWindow, weeklyWindow };
}

export function deriveSessionResetFromWeeklyReset(input: {
  readonly weeklyResetAt: string | null;
  readonly now?: Date;
}): string | null {
  if (!input.weeklyResetAt) {
    return null;
  }

  const weeklyResetMs = Date.parse(input.weeklyResetAt);
  if (Number.isNaN(weeklyResetMs)) {
    return null;
  }

  const nowMs = (input.now ?? new Date()).getTime();
  if (nowMs >= weeklyResetMs) {
    return new Date(weeklyResetMs).toISOString();
  }

  const remainingMs = weeklyResetMs - nowMs;
  const nextSessionResetOffset = remainingMs % FIVE_HOUR_WINDOW_MS;
  const derivedResetMs =
    nextSessionResetOffset === 0 ? weeklyResetMs : nowMs + nextSessionResetOffset;

  return new Date(derivedResetMs).toISOString();
}
