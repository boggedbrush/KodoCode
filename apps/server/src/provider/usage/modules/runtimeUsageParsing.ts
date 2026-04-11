import type {
  ProviderUsageState,
  ServerProviderUsageIdentity,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function walkObject(
  value: unknown,
  visitor: (record: Record<string, unknown>) => string | number | undefined,
): string | number | undefined {
  const record = asRecord(value);
  if (!record) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = walkObject(item, visitor);
        if (nested !== undefined) {
          return nested;
        }
      }
    }
    return undefined;
  }

  const direct = visitor(record);
  if (direct !== undefined) {
    return direct;
  }

  for (const nestedValue of Object.values(record)) {
    const nested = walkObject(nestedValue, visitor);
    if (nested !== undefined) {
      return nested;
    }
  }

  return undefined;
}

export function findStringByKeys(value: unknown, keys: ReadonlyArray<string>): string | undefined {
  return walkObject(value, (record) => {
    for (const key of keys) {
      const candidate = asString(record[key]);
      if (candidate) {
        return candidate;
      }
    }
    return undefined;
  }) as string | undefined;
}

export function findNumberByKeys(value: unknown, keys: ReadonlyArray<string>): number | undefined {
  return walkObject(value, (record) => {
    for (const key of keys) {
      const candidate = asNumber(record[key]);
      if (candidate !== undefined) {
        return candidate;
      }
    }
    return undefined;
  }) as number | undefined;
}

export function normalizeDateString(value: unknown): string | null {
  const direct = asString(value);
  if (direct) {
    const parsed = Date.parse(direct);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  const numeric = asNumber(value);
  if (numeric === undefined) {
    return null;
  }

  const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  if (!Number.isFinite(millis)) {
    return null;
  }
  return new Date(millis).toISOString();
}

export function parseRateLimitWindow(input: {
  readonly payload: unknown;
  readonly label: string;
  readonly key?: string;
}):
  | {
      readonly window: ServerProviderUsageWindow;
      readonly state: ProviderUsageState;
      readonly resetAt: string | null;
    }
  | undefined {
  const payload = asRecord(input.payload)?.rateLimits ?? input.payload;
  const remaining = findNumberByKeys(payload, [
    "remaining",
    "remainingRequests",
    "remaining_requests",
    "remainingTokens",
    "remaining_tokens",
    "quotaRemaining",
    "creditsRemaining",
  ]);
  const limit = findNumberByKeys(payload, [
    "limit",
    "max",
    "total",
    "requestLimit",
    "request_limit",
    "tokenLimit",
    "token_limit",
    "quota",
  ]);
  const resetAtValue = findStringByKeys(payload, [
    "resetAt",
    "reset_at",
    "resetsAt",
    "windowEndsAt",
    "window_ends_at",
  ]);
  const resetAt =
    normalizeDateString(resetAtValue) ??
    normalizeDateString(findNumberByKeys(payload, ["resetAt", "reset_at", "resetsAt"]));

  if (remaining === undefined && limit === undefined && !resetAt) {
    return undefined;
  }

  let percentUsed: number | null = null;
  if (remaining !== undefined && limit !== undefined && limit > 0) {
    percentUsed = Math.max(0, Math.min(100, ((limit - remaining) / limit) * 100));
  }

  const state: ProviderUsageState =
    remaining !== undefined && remaining <= 0
      ? "exhausted"
      : percentUsed !== null && percentUsed >= 80
        ? "limited"
        : "ready";

  return {
    window: {
      key: input.key ?? "rate-limit",
      label: input.label,
      ...(remaining !== undefined
        ? { remainingText: `${Math.max(0, Math.floor(remaining))}` }
        : {}),
      ...(limit !== undefined ? { limitText: `${Math.max(0, Math.floor(limit))}` } : {}),
      ...(remaining !== undefined && limit !== undefined
        ? { usedText: `${Math.max(0, Math.floor(limit - remaining))}` }
        : {}),
      percentUsed,
      resetAt,
    },
    state,
    resetAt,
  };
}

export function defaultIdentity(): ServerProviderUsageIdentity {
  return {
    planName: null,
    loginMethod: null,
    email: null,
    org: null,
  };
}
