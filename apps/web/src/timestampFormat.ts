import { type TimestampFormat } from "@t3tools/contracts/settings";

export function getTimestampFormatOptions(
  timestampFormat: TimestampFormat,
  includeSeconds: boolean,
): Intl.DateTimeFormatOptions {
  const baseOptions: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
  };

  if (timestampFormat === "locale") {
    return baseOptions;
  }

  return {
    ...baseOptions,
    hour12: timestampFormat === "12-hour",
  };
}

const timestampFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getTimestampFormatter(
  timestampFormat: TimestampFormat,
  includeSeconds: boolean,
): Intl.DateTimeFormat {
  const cacheKey = `${timestampFormat}:${includeSeconds ? "seconds" : "minutes"}`;
  const cachedFormatter = timestampFormatterCache.get(cacheKey);
  if (cachedFormatter) {
    return cachedFormatter;
  }

  const formatter = new Intl.DateTimeFormat(
    undefined,
    getTimestampFormatOptions(timestampFormat, includeSeconds),
  );
  timestampFormatterCache.set(cacheKey, formatter);
  return formatter;
}

export function formatTimestamp(isoDate: string, timestampFormat: TimestampFormat): string {
  return getTimestampFormatter(timestampFormat, true).format(new Date(isoDate));
}

export function formatShortTimestamp(isoDate: string, timestampFormat: TimestampFormat): string {
  return getTimestampFormatter(timestampFormat, false).format(new Date(isoDate));
}

/**
 * Format a relative time string from an ISO date.
 * Returns `{ value: "20s", suffix: "ago" }` or `{ value: "just now", suffix: null }`
 * so callers can style the numeric portion independently.
 */
export function formatRelativeTime(isoDate: string): { value: string; suffix: string | null } {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  if (diffMs < 0) return { value: "just now", suffix: null };
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 5) return { value: "just now", suffix: null };
  if (seconds < 60) return { value: `${seconds}s`, suffix: "ago" };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { value: `${minutes}m`, suffix: "ago" };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { value: `${hours}h`, suffix: "ago" };
  const days = Math.floor(hours / 24);
  return { value: `${days}d`, suffix: "ago" };
}

export function formatRelativeTimeLabel(isoDate: string) {
  const relative = formatRelativeTime(isoDate);
  return relative.suffix ? `${relative.value} ${relative.suffix}` : relative.value;
}

function secondsToCompactUnit(seconds: number): { value: number; unit: "s" | "m" | "h" | "d" } {
  if (seconds < 60) {
    return { value: seconds, unit: "s" };
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return { value: minutes, unit: "m" };
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return { value: hours, unit: "h" };
  }
  return { value: Math.floor(hours / 24), unit: "d" };
}

/**
 * Format an ISO date relative to now, with support for future times.
 * Examples: "in 12s", "in 4m", "in 2h", "in 3d", "just now", "5m ago".
 */
export function formatRelativeTimeFromNowLabel(isoDate: string): string {
  const target = new Date(isoDate).getTime();
  if (!Number.isFinite(target)) {
    return isoDate;
  }

  const diffMs = target - Date.now();
  const absSeconds = Math.floor(Math.abs(diffMs) / 1000);
  if (absSeconds < 5) {
    return "just now";
  }

  const distance = secondsToCompactUnit(absSeconds);
  const compact = `${distance.value}${distance.unit}`;
  return diffMs > 0 ? `in ${compact}` : `${compact} ago`;
}
