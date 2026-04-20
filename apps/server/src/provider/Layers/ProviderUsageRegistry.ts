import { spawn } from "node:child_process";

import type {
  ProviderRuntimeEvent,
  ProviderStartOptions,
  ProviderUsageState,
  ServerProviderUsage,
  ServerProviderUsageIdentity,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { Effect, Layer, Ref, Stream } from "effect";
import { PROVIDER_USAGE_METADATA, PROVIDER_USAGE_ORDER } from "@t3tools/shared/provider-usage";

import { parseAuthStatusFromOutput, parseClaudeAuthStatusFromOutput } from "./ProviderHealth";
import {
  ProviderUsageRegistry,
  type ProviderUsageRegistryShape,
} from "../Services/ProviderUsageRegistry";
import { ProviderService } from "../Services/ProviderService";

const STALE_AFTER_MS = 10 * 60 * 1000;

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultIdentity(): ServerProviderUsageIdentity {
  return {
    planName: null,
    loginMethod: null,
    email: null,
    org: null,
  };
}

function normalizeDateString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }
  return null;
}

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

function findStringByKeys(value: unknown, keys: ReadonlyArray<string>): string | undefined {
  const visit = (candidate: unknown): string | undefined => {
    const record = asRecord(candidate);
    if (!record) {
      if (Array.isArray(candidate)) {
        for (const item of candidate) {
          const nested = visit(item);
          if (nested) {
            return nested;
          }
        }
      }
      return undefined;
    }

    for (const key of keys) {
      const direct = asString(record[key]);
      if (direct) {
        return direct;
      }
    }

    for (const nestedValue of Object.values(record)) {
      const nested = visit(nestedValue);
      if (nested) {
        return nested;
      }
    }

    return undefined;
  };

  return visit(value);
}

function findNumberByKeys(value: unknown, keys: ReadonlyArray<string>): number | undefined {
  const visit = (candidate: unknown): number | undefined => {
    const record = asRecord(candidate);
    if (!record) {
      if (Array.isArray(candidate)) {
        for (const item of candidate) {
          const nested = visit(item);
          if (nested !== undefined) {
            return nested;
          }
        }
      }
      return undefined;
    }

    for (const key of keys) {
      const direct = asNumber(record[key]);
      if (direct !== undefined) {
        return direct;
      }
    }

    for (const nestedValue of Object.values(record)) {
      const nested = visit(nestedValue);
      if (nested !== undefined) {
        return nested;
      }
    }

    return undefined;
  };

  return visit(value);
}

function parseRateLimitWindow(input: { payload: unknown; key: string; label: string }):
  | {
      state: ProviderUsageState;
      resetAt: string | null;
      window: ServerProviderUsageWindow;
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
  const resetAt =
    normalizeDateString(
      findStringByKeys(payload, ["resetAt", "reset_at", "resetsAt", "resets_at", "windowEndsAt"]),
    ) ?? normalizeDateString(findNumberByKeys(payload, ["resetAt", "reset_at", "resetsAt"]));

  let percentUsed: number | null = null;
  if (remaining !== undefined && limit !== undefined && limit > 0) {
    percentUsed = Math.max(0, Math.min(100, ((limit - remaining) / limit) * 100));
  } else {
    const rawPercentUsed = findNumberByKeys(payload, [
      "usedPercent",
      "used_percentage",
      "used_percent",
      "percentUsed",
      "utilization",
    ]);
    if (rawPercentUsed !== undefined) {
      percentUsed =
        rawPercentUsed > 0 && rawPercentUsed <= 1 ? rawPercentUsed * 100 : rawPercentUsed;
    }
  }

  if (remaining === undefined && limit === undefined && resetAt === null && percentUsed === null) {
    return undefined;
  }

  const exhausted = remaining !== undefined && remaining <= 0;
  const limited = !exhausted && percentUsed !== null && percentUsed >= 80;
  const state: ProviderUsageState = exhausted ? "exhausted" : limited ? "limited" : "ready";

  return {
    state,
    resetAt,
    window: {
      key: input.key,
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
  };
}

function parseRateLimitWindows(input: { payload: unknown; provider: "codex" | "claudeAgent" }):
  | {
      state: ProviderUsageState;
      resetAt: string | null;
      windows: ReadonlyArray<ServerProviderUsageWindow>;
    }
  | undefined {
  const metadata = PROVIDER_USAGE_METADATA[input.provider];
  if (!metadata) {
    return undefined;
  }

  const root = asRecord(input.payload);
  const rateLimitPayload = root?.rate_limit ?? root?.rateLimit ?? input.payload;
  const sessionRecord =
    asRecord(asRecord(rateLimitPayload)?.primary_window) ??
    asRecord(asRecord(rateLimitPayload)?.primaryWindow) ??
    asRecord(asRecord(rateLimitPayload)?.five_hour) ??
    asRecord(asRecord(rateLimitPayload)?.fiveHour);
  const weeklyRecord =
    asRecord(asRecord(rateLimitPayload)?.secondary_window) ??
    asRecord(asRecord(rateLimitPayload)?.secondaryWindow) ??
    asRecord(asRecord(rateLimitPayload)?.seven_day) ??
    asRecord(asRecord(rateLimitPayload)?.sevenDay);

  const parsedSession = sessionRecord
    ? parseRateLimitWindow({
        payload: sessionRecord,
        key: `${input.provider}-session`,
        label: metadata.sessionLabel,
      })
    : undefined;
  const parsedWeekly = weeklyRecord
    ? parseRateLimitWindow({
        payload: weeklyRecord,
        key: `${input.provider}-weekly`,
        label: metadata.weeklyLabel,
      })
    : undefined;
  const parsedGeneric =
    !parsedSession && !parsedWeekly
      ? parseRateLimitWindow({
          payload: rateLimitPayload,
          key: `${input.provider}-session`,
          label: metadata.sessionLabel,
        })
      : undefined;

  const parsed = [parsedSession, parsedWeekly, parsedGeneric].filter(
    (value): value is NonNullable<typeof value> => value !== undefined,
  );
  if (parsed.length === 0) {
    return undefined;
  }

  const state: ProviderUsageState = parsed.some((entry) => entry.state === "exhausted")
    ? "exhausted"
    : parsed.some((entry) => entry.state === "limited")
      ? "limited"
      : "ready";
  const resetAt =
    parsed.find((entry) => entry.resetAt !== null)?.resetAt ??
    parsedSession?.resetAt ??
    parsedWeekly?.resetAt ??
    null;

  return {
    state,
    resetAt,
    windows: parsed.map((entry) => entry.window),
  };
}

function unknownUsage(provider: "codex" | "claudeAgent", detail: string): ServerProviderUsage {
  return {
    provider,
    status: "unknown",
    source: "poll",
    checkedAt: nowIso(),
    stale: false,
    summary: null,
    detail,
    resetAt: null,
    identity: defaultIdentity(),
    windows: [],
  };
}

function applyStaleFlags(
  usages: ReadonlyArray<ServerProviderUsage>,
): ReadonlyArray<ServerProviderUsage> {
  const now = Date.now();
  return usages.map((usage) => {
    const checkedAt = Date.parse(usage.checkedAt);
    return {
      ...usage,
      stale: Number.isNaN(checkedAt) ? true : now - checkedAt > STALE_AFTER_MS,
    };
  });
}

function sortUsages(
  usages: ReadonlyArray<ServerProviderUsage>,
): ReadonlyArray<ServerProviderUsage> {
  const order = new Map(PROVIDER_USAGE_ORDER.map((provider, index) => [provider, index]));
  return [...usages].sort(
    (left, right) =>
      (order.get(left.provider) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.provider) ?? Number.MAX_SAFE_INTEGER),
  );
}

function mergeUsage(
  next: ServerProviderUsage,
  previous: ServerProviderUsage | undefined,
): ServerProviderUsage {
  if (!previous) {
    return next;
  }

  const keepRuntimeLimits =
    previous.windows.length > 0 &&
    (previous.status === "limited" ||
      previous.status === "exhausted" ||
      previous.source === "runtime");
  if (!keepRuntimeLimits) {
    return next;
  }

  return {
    ...next,
    status: previous.status,
    summary: previous.summary ?? next.summary,
    detail: previous.detail ?? next.detail,
    resetAt: previous.resetAt ?? next.resetAt,
    windows: previous.windows,
  };
}

function parseClaudeIdentity(stdout: string): ServerProviderUsageIdentity {
  try {
    const parsed = JSON.parse(stdout);
    return {
      planName:
        findStringByKeys(parsed, [
          "plan",
          "planType",
          "subscriptionType",
          "subscription_type",
          "subscription",
          "tier",
        ]) ?? null,
      loginMethod:
        findStringByKeys(parsed, ["authMethod", "auth_method", "loginMethod", "login_method"]) ??
        null,
      email: findStringByKeys(parsed, ["email"]) ?? null,
      org: findStringByKeys(parsed, ["org", "orgName", "organization", "organizationName"]) ?? null,
    };
  } catch {
    return defaultIdentity();
  }
}

function usageSummary(
  provider: "codex" | "claudeAgent",
  status: ProviderUsageState,
): string | null {
  if (status === "exhausted") {
    return `${PROVIDER_USAGE_METADATA[provider]?.displayName ?? provider} usage exhausted`;
  }
  if (status === "limited") {
    return `${PROVIDER_USAGE_METADATA[provider]?.displayName ?? provider} usage limited`;
  }
  return null;
}

function runCommand(input: {
  command: string;
  args: ReadonlyArray<string>;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Effect.Effect<CommandResult, Error> {
  return Effect.promise(
    () =>
      new Promise<CommandResult>((resolve, reject) => {
        const child = spawn(input.command, [...input.args], {
          env: input.env,
          shell: process.platform === "win32",
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`Command timed out: ${input.command}`));
        }, input.timeoutMs);

        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
        child.once("close", (code) => {
          clearTimeout(timer);
          resolve({
            stdout,
            stderr,
            code: code ?? 0,
          });
        });
      }),
  );
}

function probeCodexUsage(
  providerOptions: ProviderStartOptions | undefined,
  previous: ServerProviderUsage | undefined,
): Effect.Effect<ServerProviderUsage> {
  const binaryPath = providerOptions?.codex?.binaryPath?.trim() || "codex";
  const homePath = providerOptions?.codex?.homePath?.trim();

  return runCommand({
    command: binaryPath,
    args: ["login", "status"],
    env: homePath ? { ...process.env, CODEX_HOME: homePath } : process.env,
    timeoutMs: 4_000,
  }).pipe(
    Effect.map((result) => {
      const parsed = parseAuthStatusFromOutput(result);
      const next = {
        provider: "codex" as const,
        status:
          parsed.status === "ready"
            ? "ready"
            : parsed.authStatus === "unauthenticated"
              ? "error"
              : "unknown",
        source: "poll" as const,
        checkedAt: nowIso(),
        stale: false,
        summary:
          usageSummary(
            "codex",
            parsed.status === "ready"
              ? "ready"
              : parsed.authStatus === "unauthenticated"
                ? "error"
                : "unknown",
          ) ?? (parsed.authStatus === "authenticated" ? "Codex account detected" : null),
        detail: parsed.message ?? null,
        resetAt: previous?.resetAt ?? null,
        identity: {
          ...defaultIdentity(),
          ...(parsed.authStatus === "authenticated" ? { loginMethod: "Authenticated" } : {}),
          ...(previous?.identity ?? {}),
        },
        windows: previous?.windows ?? [],
      } satisfies ServerProviderUsage;
      return mergeUsage(next, previous);
    }),
    Effect.catch((error) =>
      Effect.succeed(
        mergeUsage(
          {
            ...unknownUsage(
              "codex",
              error instanceof Error ? error.message : "Failed to fetch Codex usage.",
            ),
            status: "error",
          },
          previous,
        ),
      ),
    ),
  );
}

function probeClaudeUsage(
  providerOptions: ProviderStartOptions | undefined,
  previous: ServerProviderUsage | undefined,
): Effect.Effect<ServerProviderUsage> {
  const binaryPath = providerOptions?.claudeAgent?.binaryPath?.trim() || "claude";

  return runCommand({
    command: binaryPath,
    args: ["auth", "status"],
    env: process.env,
    timeoutMs: 4_000,
  }).pipe(
    Effect.map((result) => {
      const parsed = parseClaudeAuthStatusFromOutput(result);
      const identity = parseClaudeIdentity(result.stdout);
      const next = {
        provider: "claudeAgent" as const,
        status:
          parsed.status === "ready"
            ? "ready"
            : parsed.authStatus === "unauthenticated"
              ? "error"
              : "unknown",
        source: "poll" as const,
        checkedAt: nowIso(),
        stale: false,
        summary:
          usageSummary(
            "claudeAgent",
            parsed.status === "ready"
              ? "ready"
              : parsed.authStatus === "unauthenticated"
                ? "error"
                : "unknown",
          ) ?? (parsed.authStatus === "authenticated" ? "Claude account detected" : null),
        detail: parsed.message ?? null,
        resetAt: previous?.resetAt ?? null,
        identity: {
          ...previous?.identity,
          ...identity,
        },
        windows: previous?.windows ?? [],
      } satisfies ServerProviderUsage;
      return mergeUsage(next, previous);
    }),
    Effect.catch((error) =>
      Effect.succeed(
        mergeUsage(
          {
            ...unknownUsage(
              "claudeAgent",
              error instanceof Error ? error.message : "Failed to fetch Claude usage.",
            ),
            status: "error",
          },
          previous,
        ),
      ),
    ),
  );
}

function mergeRuntimeEvent(
  usage: ServerProviderUsage,
  event: ProviderRuntimeEvent,
): ServerProviderUsage | undefined {
  if (usage.provider !== event.provider) {
    return undefined;
  }

  if (event.type === "account.updated") {
    const planName =
      findStringByKeys(event.payload.account, [
        "planName",
        "plan",
        "planType",
        "subscriptionType",
        "subscription",
      ]) ?? usage.identity.planName;
    const email = findStringByKeys(event.payload.account, ["email"]) ?? usage.identity.email;
    const org =
      findStringByKeys(event.payload.account, ["org", "organization"]) ?? usage.identity.org;
    if (!planName && !email && !org) {
      return undefined;
    }
    return {
      ...usage,
      source: "runtime",
      checkedAt: nowIso(),
      summary: planName ? `Plan: ${planName}` : usage.summary,
      identity: {
        ...usage.identity,
        ...(planName ? { planName } : {}),
        ...(email ? { email } : {}),
        ...(org ? { org } : {}),
      },
    };
  }

  if (event.type === "account.rate-limits.updated") {
    const parsed = parseRateLimitWindows({
      payload: event.payload.rateLimits,
      provider: usage.provider === "codex" ? "codex" : "claudeAgent",
    });
    if (!parsed) {
      return undefined;
    }
    return {
      ...usage,
      source: "runtime",
      checkedAt: nowIso(),
      status: parsed.state,
      summary: usageSummary(usage.provider === "codex" ? "codex" : "claudeAgent", parsed.state),
      resetAt: parsed.resetAt,
      windows: parsed.windows,
    };
  }

  return undefined;
}

export const ProviderUsageRegistryLive = Layer.effect(
  ProviderUsageRegistry,
  Effect.gen(function* () {
    const providerService = yield* ProviderService;
    const usagesRef = yield* Ref.make<ReadonlyArray<ServerProviderUsage>>([
      unknownUsage("codex", "Usage data has not been loaded yet."),
      unknownUsage("claudeAgent", "Usage data has not been loaded yet."),
    ]);

    const applyRuntimeUpdate = Effect.fn("applyRuntimeUpdate")(function* (
      event: ProviderRuntimeEvent,
    ) {
      const current = yield* Ref.get(usagesRef);
      const next = current.map((usage) => mergeRuntimeEvent(usage, event) ?? usage);
      yield* Ref.set(usagesRef, sortUsages(next));
    });

    yield* Stream.runForEach(providerService.streamEvents, applyRuntimeUpdate).pipe(
      Effect.forkScoped,
    );

    const refresh = Effect.fn("refreshUsage")(function* (providerOptions?: ProviderStartOptions) {
      const current = yield* Ref.get(usagesRef);
      const currentByProvider = new Map(current.map((usage) => [usage.provider, usage]));
      const next = yield* Effect.all(
        [
          probeCodexUsage(providerOptions, currentByProvider.get("codex")),
          probeClaudeUsage(providerOptions, currentByProvider.get("claudeAgent")),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.map(sortUsages));
      yield* Ref.set(usagesRef, next);
      return applyStaleFlags(next);
    });

    return {
      getUsages: (providerOptions?: ProviderStartOptions) =>
        Ref.get(usagesRef).pipe(
          Effect.flatMap((usages) => {
            const needsBootstrap = usages.every(
              (usage) => usage.summary === null && usage.windows.length === 0,
            );
            return needsBootstrap
              ? refresh(providerOptions)
              : Effect.succeed(applyStaleFlags(usages));
          }),
        ),
      refresh,
    } satisfies ProviderUsageRegistryShape;
  }),
);
