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
import { defaultIdentity, findStringByKeys, parseRateLimitWindow } from "./runtimeUsageParsing";

const PROVIDER = "claudeAgent" as const;

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function nowIso(): string {
  return new Date().toISOString();
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
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { planName: null, loginMethod: null, email: null };
  }

  const planName =
    findStringByKeys(parsed, ["plan", "planType", "subscriptionType", "subscription", "tier"]) ??
    null;
  const loginMethod = findStringByKeys(parsed, ["authMethod", "auth_method"]) ?? null;
  const email = findStringByKeys(parsed, ["email"]) ?? null;
  return { planName, loginMethod, email };
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
              org: null,
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
    strategies: [claudeAuthStatusStrategy, claudeSdkProbeStrategy],
    mergeRuntimeEvent: (event, current) => {
      if (event.provider !== PROVIDER) {
        return undefined;
      }

      if (event.type === "account.updated") {
        const planName = findStringByKeys(event.payload.account, [
          "subscriptionType",
          "planType",
          "plan",
          "tier",
        ]);
        const loginMethod = findStringByKeys(event.payload.account, ["authMethod", "auth_method"]);
        const email = findStringByKeys(event.payload.account, ["email"]);
        if (!planName && !loginMethod && !email) {
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
          },
        };
      }

      if (event.type === "account.rate-limits.updated") {
        const parsed = parseRateLimitWindow({
          payload: event.payload.rateLimits,
          label: PROVIDER_USAGE_METADATA.claudeAgent.sessionLabel,
          key: "claude-rate-limit",
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
          windows: [parsed.window],
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
