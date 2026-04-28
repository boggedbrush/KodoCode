import { query as claudeQuery } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderUsageState } from "@t3tools/contracts";
import { PROVIDER_USAGE_METADATA } from "@t3tools/shared/provider-usage";
import { Effect, Option, Result } from "effect";

import { parseClaudeAuthStatusFromOutput } from "../../Layers/ClaudeProvider";
import { isCommandMissingCause } from "../../providerSnapshot";
import { ServerSettingsService } from "../../../serverSettings";
import {
  fetchWithFallback,
  type ProviderUsageSnapshot,
  type UsageProviderModule,
} from "../fetchStrategy";
import { makeSubprocessApi } from "../hostApis";
import {
  defaultIdentity,
  findStringByKeys,
  mergeUsageWindows,
  parseRateLimitWindows,
} from "./runtimeUsageParsing";

const PROVIDER = "claudeAgent" as const;
const CLAUDE_OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_OAUTH_BETA_HEADER = "oauth-2025-04-20";

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function nowIso(): string {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeClaudePlanName(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }

  const normalized = raw.toLowerCase().replace(/[\s_-]+/g, "");
  switch (normalized) {
    case "pro":
    case "claudepro":
    case "defaultclaudeai":
      return "pro";
    case "max":
    case "max5":
    case "max20":
    case "maxplan":
    case "claudemax":
      return "max";
    case "team":
    case "claudeteam":
      return "team";
    case "enterprise":
    case "claudeenterprise":
      return "enterprise";
    case "free":
    case "claudefree":
      return "free";
    default:
      return raw;
  }
}

function toUsageState(status: "ready" | "warning" | "error"): ProviderUsageState {
  switch (status) {
    case "ready":
      return "ready";
    case "error":
      return "error";
    case "warning":
    default:
      return "unknown";
  }
}

function parseAuthStatusJson(stdout: string): {
  readonly planName: string | null;
  readonly loginMethod: string | null;
  readonly email: string | null;
  readonly org: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { planName: null, loginMethod: null, email: null, org: null };
  }

  const planName = normalizeClaudePlanName(
    findStringByKeys(parsed, ["plan", "planType", "subscriptionType", "subscription", "tier"]),
  );
  const loginMethod = findStringByKeys(parsed, ["authMethod", "auth_method"]) ?? null;
  const email = findStringByKeys(parsed, ["email"]) ?? null;
  const org =
    findStringByKeys(parsed, ["orgName", "organization", "organizationName", "org"]) ?? null;
  return { planName, loginMethod, email, org };
}

function parseClaudeOAuthCredentials(stdout: string): {
  readonly accessToken: string | null;
  readonly planName: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { accessToken: null, planName: null };
  }

  const root = asRecord(parsed);
  const oauth = asRecord(root?.claudeAiOauth) ?? root;
  return {
    accessToken: asString(oauth?.accessToken) ?? null,
    planName: normalizeClaudePlanName(
      asString(oauth?.subscriptionType) ??
        asString(oauth?.rateLimitTier) ??
        findStringByKeys(parsed, ["subscriptionType", "subscription_type", "rateLimitTier"]),
    ),
  };
}

const fetchClaudeOAuthUsage = (accessToken: string) =>
  Effect.tryPromise(async () => {
    const response = await fetch(CLAUDE_OAUTH_USAGE_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "anthropic-beta": CLAUDE_OAUTH_BETA_HEADER,
      },
    });
    if (!response.ok) {
      throw new Error(`Claude OAuth usage request failed with HTTP ${response.status}`);
    }
    return await response.json();
  }).pipe(Effect.mapError(toError));

function snapshotFromOAuthUsage(input: {
  readonly payload: unknown;
  readonly planName: string | null;
}): ProviderUsageSnapshot {
  const parsedRateLimits = parseRateLimitWindows({
    payload: input.payload,
    sessionLabel: PROVIDER_USAGE_METADATA.claudeAgent.sessionLabel,
    weeklyLabel: PROVIDER_USAGE_METADATA.claudeAgent.weeklyLabel,
    keyPrefix: "claude-oauth",
  });
  const status = parsedRateLimits?.state ?? (input.planName ? "ready" : "unknown");
  const summary =
    status === "exhausted"
      ? "Claude usage exhausted"
      : status === "limited"
        ? "Claude usage limited"
        : input.planName
          ? `Plan: ${input.planName}`
          : "Claude usage status";

  return {
    provider: PROVIDER,
    checkedAt: nowIso(),
    status,
    summary,
    detail: null,
    resetAt: parsedRateLimits?.resetAt ?? null,
    identity: {
      ...defaultIdentity(),
      ...(input.planName ? { planName: input.planName } : {}),
      loginMethod: "claude.ai",
    },
    windows: parsedRateLimits?.windows ?? [],
  };
}

const probeClaudeSubscriptionType = (binaryPath: string) => {
  const abort = new AbortController();
  return Effect.tryPromise(async () => {
    const query = claudeQuery({
      prompt: ".",
      options: {
        persistSession: false,
        pathToClaudeCodeExecutable: binaryPath,
        abortController: abort,
        maxTurns: 0,
        settingSources: [],
        allowedTools: [],
        stderr: () => {},
      },
    });

    const init = await query.initializationResult();
    return init.account?.subscriptionType ?? null;
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (!abort.signal.aborted) {
          abort.abort();
        }
      }),
    ),
    Effect.timeoutOption(8_000),
    Effect.map((result) => (Option.isSome(result) ? result.value : null)),
    Effect.mapError(toError),
  );
};

export const makeClaudeUsageModule = Effect.gen(function* () {
  const subprocess = yield* makeSubprocessApi;
  const settingsService = yield* ServerSettingsService;
  const claudeSettings = settingsService.getSettings.pipe(
    Effect.map((settings) => settings.providers.claudeAgent),
    Effect.mapError(toError),
  );

  const claudeOAuthUsageStrategy = {
    id: "claude.oauthUsage",
    kind: "oauth" as const,
    isAvailable: claudeSettings.pipe(
      Effect.map((settings) => settings.enabled && process.platform === "darwin"),
      Effect.catch(() => Effect.succeed(false)),
    ),
    fetch: subprocess
      .run({
        command: "security",
        args: ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
        timeoutMs: 4_000,
      })
      .pipe(
        Effect.flatMap((result) => {
          if (result.exitCode !== 0) {
            return Effect.fail(
              new Error(result.stderr || "Failed to read Claude OAuth credentials from keychain."),
            );
          }

          const credentials = parseClaudeOAuthCredentials(result.stdout.trim());
          if (!credentials.accessToken) {
            return Effect.fail(new Error("Claude OAuth access token not found in keychain."));
          }

          return fetchClaudeOAuthUsage(credentials.accessToken).pipe(
            Effect.map((payload) => ({
              sourceLabel: "oauth-usage",
              usage: snapshotFromOAuthUsage({
                payload,
                planName: credentials.planName,
              }),
            })),
          );
        }),
      ),
    shouldFallback: (error: Error) => !isCommandMissingCause(error),
  };

  const claudeAuthStatusStrategy = {
    id: "claude.authStatus",
    kind: "cli" as const,
    isAvailable: claudeSettings.pipe(
      Effect.map((settings) => settings.enabled),
      Effect.catch(() => Effect.succeed(false)),
    ),
    fetch: claudeSettings.pipe(
      Effect.flatMap((providerSettings) =>
        subprocess.run({
          command: providerSettings.binaryPath,
          args: ["auth", "status"],
          timeoutMs: 4_000,
        }),
      ),
      Effect.map((result) => {
        const parsedStatus = parseClaudeAuthStatusFromOutput({
          stdout: result.stdout,
          stderr: result.stderr,
          code: result.exitCode,
        });
        const parsedJson = parseAuthStatusJson(result.stdout);

        return {
          sourceLabel: "auth-status",
          usage: {
            provider: PROVIDER,
            checkedAt: nowIso(),
            status: toUsageState(parsedStatus.status),
            summary:
              parsedJson.planName !== null ? `Plan: ${parsedJson.planName}` : "Claude account",
            detail: parsedStatus.message ?? null,
            resetAt: null,
            identity: {
              planName: parsedJson.planName,
              loginMethod: parsedJson.loginMethod,
              email: parsedJson.email,
              org: parsedJson.org,
            },
            windows: [],
            raw: result.stdout || result.stderr || null,
          } satisfies ProviderUsageSnapshot,
        };
      }),
    ),
    shouldFallback: (error: Error) => !isCommandMissingCause(error),
  };

  const claudeSdkProbeStrategy = {
    id: "claude.sdkProbe",
    kind: "rpc" as const,
    isAvailable: claudeSettings.pipe(
      Effect.map((settings) => settings.enabled),
      Effect.catch(() => Effect.succeed(false)),
    ),
    fetch: claudeSettings.pipe(
      Effect.map((settings) => settings.binaryPath),
      Effect.flatMap((binaryPath) => probeClaudeSubscriptionType(binaryPath)),
      Effect.map((subscriptionType) => ({
        sourceLabel: "sdk-probe",
        usage: {
          provider: PROVIDER,
          checkedAt: nowIso(),
          status: subscriptionType ? "ready" : "unknown",
          summary: subscriptionType ? `Plan: ${subscriptionType}` : "Claude account detected",
          detail: null,
          resetAt: null,
          identity: {
            ...defaultIdentity(),
            ...(subscriptionType ? { planName: subscriptionType } : {}),
          },
          windows: [],
        } satisfies ProviderUsageSnapshot,
      })),
    ),
    shouldFallback: (_error: Error) => false,
  };

  return {
    metadata: PROVIDER_USAGE_METADATA.claudeAgent,
    strategies: [claudeOAuthUsageStrategy, claudeAuthStatusStrategy, claudeSdkProbeStrategy],
    mergeRuntimeEvent: (event, current) => {
      if (event.provider !== PROVIDER) {
        return undefined;
      }

      if (event.type === "account.updated") {
        const planName = normalizeClaudePlanName(
          findStringByKeys(event.payload.account, [
            "subscriptionType",
            "planType",
            "plan",
            "tier",
            "rateLimitTier",
          ]),
        );
        const loginMethod = findStringByKeys(event.payload.account, ["authMethod", "auth_method"]);
        const email = findStringByKeys(event.payload.account, ["email"]);
        const org = findStringByKeys(event.payload.account, [
          "orgName",
          "organization",
          "organizationName",
          "org",
        ]);
        if (!planName && !loginMethod && !email && !org) {
          return undefined;
        }

        return {
          ...current,
          checkedAt: nowIso(),
          summary: planName ? `Plan: ${planName}` : current.summary,
          identity: {
            ...current.identity,
            ...(planName ? { planName } : {}),
            ...(loginMethod ? { loginMethod } : {}),
            ...(email ? { email } : {}),
            ...(org ? { org } : {}),
          },
        };
      }

      if (event.type === "account.rate-limits.updated") {
        const parsed = parseRateLimitWindows({
          payload: event.payload.rateLimits,
          sessionLabel: PROVIDER_USAGE_METADATA.claudeAgent.sessionLabel,
          weeklyLabel: PROVIDER_USAGE_METADATA.claudeAgent.weeklyLabel,
          keyPrefix: "claude-rate-limit",
        });
        if (!parsed) {
          return undefined;
        }
        return {
          ...current,
          checkedAt: nowIso(),
          status: parsed.state,
          summary:
            parsed.state === "exhausted"
              ? "Claude usage exhausted"
              : parsed.state === "limited"
                ? "Claude usage limited"
                : current.summary,
          resetAt: parsed.resetAt,
          windows: mergeUsageWindows(current.windows, parsed.windows),
        };
      }

      return undefined;
    },
  } satisfies UsageProviderModule;
});

export const fetchClaudeUsage = Effect.gen(function* () {
  const module = yield* makeClaudeUsageModule;
  const result = yield* fetchWithFallback(module.strategies).pipe(Effect.result);
  if (Result.isSuccess(result)) {
    return result.success.usage;
  }

  const error = result.failure;
  return {
    provider: PROVIDER,
    checkedAt: nowIso(),
    status: isCommandMissingCause(error) ? "error" : "unknown",
    summary: null,
    detail:
      error instanceof Error
        ? error.message
        : "Failed to fetch Claude usage using available strategies.",
    resetAt: null,
    identity: defaultIdentity(),
    windows: [],
  } satisfies ProviderUsageSnapshot;
});

export const claudePtyUsageStrategyPlaceholder = {
  id: "claude.ptyUsage",
  kind: "cli" as const,
  isAvailable: Effect.succeed(false),
  fetch: Effect.fail(new Error("PTY strategy is not enabled in v1.")),
  shouldFallback: () => false,
};
