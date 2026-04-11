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

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
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
    "resets_at",
    "resetsAt",
    "windowEndsAt",
    "window_ends_at",
  ]);
  const resetAt =
    normalizeDateString(resetAtValue) ??
    normalizeDateString(
      findNumberByKeys(payload, ["resetAt", "reset_at", "resets_at", "resetsAt"]),
    );

  const rawPercentUsed = findNumberByKeys(payload, [
    "usedPercent",
    "used_percent",
    "used_percentage",
    "percentUsed",
    "utilization",
  ]);
  const derivedPercentUsed =
    rawPercentUsed === undefined
      ? null
      : Math.max(
          0,
          Math.min(
            100,
            rawPercentUsed > 0 && rawPercentUsed <= 1 ? rawPercentUsed * 100 : rawPercentUsed,
          ),
        );
  if (remaining === undefined && limit === undefined && !resetAt) {
    if (derivedPercentUsed === null) {
      return undefined;
    }
  }

  let percentUsed: number | null = null;
  if (remaining !== undefined && limit !== undefined && limit > 0) {
    percentUsed = Math.max(0, Math.min(100, ((limit - remaining) / limit) * 100));
  } else if (derivedPercentUsed !== null) {
    percentUsed = derivedPercentUsed;
  }

  const payloadRecord = asRecord(payload);
  const status = findStringByKeys(payload, ["status"])?.toLowerCase();
  const exhaustedByFlag =
    asBoolean(payloadRecord?.limit_reached) === true ||
    asBoolean(payloadRecord?.limitReached) === true ||
    status === "rejected";
  const limitedByFlag = status === "allowed_warning" || status === "warning";
  const state: ProviderUsageState =
    exhaustedByFlag || (remaining !== undefined && remaining <= 0)
      ? "exhausted"
      : limitedByFlag || (percentUsed !== null && percentUsed >= 80)
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

function pickNestedRecord(
  payload: unknown,
  keys: ReadonlyArray<string>,
): Record<string, unknown> | undefined {
  const record = asRecord(payload);
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const nested = asRecord(record[key]);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function chooseMostSevereState(
  states: ReadonlyArray<ProviderUsageState>,
): ProviderUsageState | undefined {
  if (states.includes("error")) return "error";
  if (states.includes("exhausted")) return "exhausted";
  if (states.includes("limited")) return "limited";
  if (states.includes("ready")) return "ready";
  if (states.includes("unknown")) return "unknown";
  return undefined;
}

export function parseRateLimitWindows(input: {
  readonly payload: unknown;
  readonly sessionLabel: string;
  readonly weeklyLabel: string;
  readonly keyPrefix: string;
}):
  | {
      readonly windows: ReadonlyArray<ServerProviderUsageWindow>;
      readonly state: ProviderUsageState;
      readonly resetAt: string | null;
    }
  | undefined {
  const payloadRecord = asRecord(input.payload);
  const rateLimitPayload = payloadRecord?.rate_limit ?? payloadRecord?.rateLimit ?? input.payload;

  const sessionRecord = pickNestedRecord(rateLimitPayload, [
    "primary_window",
    "primaryWindow",
    "five_hour",
    "fiveHour",
  ]);
  const weeklyRecord = pickNestedRecord(rateLimitPayload, [
    "secondary_window",
    "secondaryWindow",
    "seven_day",
    "sevenDay",
  ]);

  const parsedSession = sessionRecord
    ? parseRateLimitWindow({
        payload: sessionRecord,
        label: input.sessionLabel,
        key: `${input.keyPrefix}-session`,
      })
    : undefined;
  const parsedWeekly = weeklyRecord
    ? parseRateLimitWindow({
        payload: weeklyRecord,
        label: input.weeklyLabel,
        key: `${input.keyPrefix}-weekly`,
      })
    : undefined;

  const explicitRateLimitType = findStringByKeys(rateLimitPayload, [
    "rateLimitType",
    "rate_limit_type",
  ])?.toLowerCase();
  const parsedTypedRateLimit =
    !sessionRecord && !weeklyRecord && explicitRateLimitType
      ? parseRateLimitWindow({
          payload: rateLimitPayload,
          label:
            explicitRateLimitType.includes("seven_day") || explicitRateLimitType.includes("week")
              ? input.weeklyLabel
              : input.sessionLabel,
          key:
            explicitRateLimitType.includes("seven_day") || explicitRateLimitType.includes("week")
              ? `${input.keyPrefix}-weekly`
              : `${input.keyPrefix}-session`,
        })
      : undefined;
  const parsedGeneric =
    !sessionRecord && !weeklyRecord && !parsedTypedRateLimit
      ? parseRateLimitWindow({
          payload: rateLimitPayload,
          label: input.sessionLabel,
          key: `${input.keyPrefix}-session`,
        })
      : undefined;

  const byKey = new Map<string, ServerProviderUsageWindow>();
  for (const candidate of [parsedSession, parsedWeekly, parsedTypedRateLimit, parsedGeneric]) {
    if (candidate?.window) {
      byKey.set(candidate.window.key, candidate.window);
    }
  }

  const windows = [...byKey.values()];
  if (windows.length === 0) {
    return undefined;
  }

  const state =
    chooseMostSevereState(
      [parsedSession, parsedWeekly, parsedTypedRateLimit, parsedGeneric]
        .map((candidate) => candidate?.state)
        .filter((candidate): candidate is ProviderUsageState => candidate !== undefined),
    ) ?? "unknown";

  const resetAt = normalizeDateString(
    windows
      .map((window) => window.resetAt)
      .find((value): value is string => typeof value === "string" && value.length > 0),
  );

  return {
    windows,
    state,
    resetAt,
  };
}

export function mergeUsageWindows(
  current: ReadonlyArray<ServerProviderUsageWindow>,
  incoming: ReadonlyArray<ServerProviderUsageWindow>,
): ReadonlyArray<ServerProviderUsageWindow> {
  const byKey = new Map(current.map((window) => [window.key, window]));
  for (const window of incoming) {
    byKey.set(window.key, window);
  }
  return [...byKey.values()];
}

export function defaultIdentity(): ServerProviderUsageIdentity {
  return {
    planName: null,
    loginMethod: null,
    email: null,
    org: null,
  };
}
