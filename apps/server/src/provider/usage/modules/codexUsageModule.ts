import type { ProviderUsageState } from "@t3tools/contracts";
import { PROVIDER_USAGE_METADATA } from "@t3tools/shared/provider-usage";
import { Effect, Result } from "effect";

import { type CodexAccountSnapshot, codexAuthSubLabel } from "../../codexAccount";
import { parseAuthStatusFromOutput } from "../../Layers/CodexProvider";
import { isCommandMissingCause } from "../../providerSnapshot";
import { ServerSettingsService } from "../../../serverSettings";
import {
  fetchWithFallback,
  type ProviderUsageSnapshot,
  type UsageProviderModule,
} from "../fetchStrategy";
import { makeCodexAccountProbeApi, makeSubprocessApi } from "../hostApis";
import { defaultIdentity, findStringByKeys, parseRateLimitWindow } from "./runtimeUsageParsing";

const PROVIDER = "codex" as const;

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

function snapshotFromAccount(account: CodexAccountSnapshot): ProviderUsageSnapshot {
  const planName = codexAuthSubLabel(account) ?? null;
  const loginMethod =
    account.type === "apiKey" ? "API key" : account.type === "chatgpt" ? "ChatGPT" : null;

  return {
    provider: PROVIDER,
    checkedAt: nowIso(),
    status: planName ? "ready" : "unknown",
    summary: planName ? `Plan: ${planName}` : "Codex account detected",
    detail: null,
    resetAt: null,
    identity: {
      planName,
      loginMethod,
      email: null,
      org: null,
    },
    windows: [],
  };
}

export const makeCodexUsageModule = Effect.gen(function* () {
  const subprocess = yield* makeSubprocessApi;
  const accountProbe = yield* makeCodexAccountProbeApi;
  const settingsService = yield* ServerSettingsService;
  const codexSettings = settingsService.getSettings.pipe(
    Effect.map((settings) => settings.providers.codex),
    Effect.mapError(toError),
  );

  const codexAccountProbeStrategy = {
    id: "codex.accountProbe",
    kind: "rpc" as const,
    isAvailable: codexSettings.pipe(
      Effect.map((settings) => settings.enabled),
      Effect.catch(() => Effect.succeed(false)),
    ),
    fetch: codexSettings.pipe(
      Effect.flatMap((providerSettings) =>
        accountProbe.probe({
          binaryPath: providerSettings.binaryPath,
          ...(providerSettings.homePath ? { homePath: providerSettings.homePath } : {}),
          timeoutMs: 8_000,
        }),
      ),
      Effect.flatMap((account) =>
        account.type === "unknown"
          ? Effect.fail(new Error("Codex account probe returned unknown account type."))
          : Effect.succeed(account),
      ),
      Effect.map((account) => ({
        sourceLabel: "account-probe",
        usage: snapshotFromAccount(account),
      })),
    ),
    shouldFallback: (error: Error) => !isCommandMissingCause(error),
  };

  const codexLoginStatusStrategy = {
    id: "codex.loginStatus",
    kind: "cli" as const,
    isAvailable: codexSettings.pipe(
      Effect.map((settings) => settings.enabled),
      Effect.catch(() => Effect.succeed(false)),
    ),
    fetch: codexSettings.pipe(
      Effect.flatMap((providerSettings) =>
        subprocess.run({
          command: providerSettings.binaryPath,
          args: ["login", "status"],
          timeoutMs: 4_000,
          ...(providerSettings.homePath ? { env: { CODEX_HOME: providerSettings.homePath } } : {}),
        }),
      ),
      Effect.map((result) => {
        const parsed = parseAuthStatusFromOutput({
          stdout: result.stdout,
          stderr: result.stderr,
          code: result.exitCode,
        });

        return {
          sourceLabel: "login-status",
          usage: {
            provider: PROVIDER,
            checkedAt: nowIso(),
            status: toUsageState(parsed.status),
            summary:
              parsed.auth.status === "authenticated"
                ? "Codex authentication verified"
                : "Codex authentication status unavailable",
            detail: parsed.message ?? null,
            resetAt: null,
            identity: {
              ...defaultIdentity(),
              loginMethod:
                parsed.auth.status === "authenticated"
                  ? "Authenticated"
                  : parsed.auth.status === "unauthenticated"
                    ? "Unauthenticated"
                    : null,
            },
            windows: [],
            raw: result.stdout || result.stderr || null,
          } satisfies ProviderUsageSnapshot,
        };
      }),
    ),
    shouldFallback: (error: Error) => !isCommandMissingCause(error),
  };

  return {
    metadata: PROVIDER_USAGE_METADATA.codex,
    strategies: [codexAccountProbeStrategy, codexLoginStatusStrategy],
    mergeRuntimeEvent: (event, current) => {
      if (event.provider !== PROVIDER) {
        return undefined;
      }

      if (event.type === "account.updated") {
        const planName = findStringByKeys(event.payload.account, [
          "planName",
          "plan",
          "planType",
          "subscriptionType",
          "subscription",
        ]);
        const email = findStringByKeys(event.payload.account, ["email"]);
        const org = findStringByKeys(event.payload.account, ["org", "organization"]);

        if (!planName && !email && !org) {
          return undefined;
        }

        return {
          ...current,
          checkedAt: nowIso(),
          summary: planName ? `Plan: ${planName}` : current.summary,
          identity: {
            ...current.identity,
            ...(planName ? { planName } : {}),
            ...(email ? { email } : {}),
            ...(org ? { org } : {}),
          },
        };
      }

      if (event.type === "account.rate-limits.updated") {
        const parsed = parseRateLimitWindow({
          payload: event.payload.rateLimits,
          label: PROVIDER_USAGE_METADATA.codex.sessionLabel,
          key: "codex-rate-limit",
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
              ? "Codex usage exhausted"
              : parsed.state === "limited"
                ? "Codex usage limited"
                : current.summary,
          resetAt: parsed.resetAt,
          windows: [parsed.window],
        };
      }

      return undefined;
    },
  } satisfies UsageProviderModule;
});

export const fetchCodexUsage = Effect.gen(function* () {
  const module = yield* makeCodexUsageModule;
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
        : "Failed to fetch Codex usage using available strategies.",
    resetAt: null,
    identity: defaultIdentity(),
    windows: [],
  } satisfies ProviderUsageSnapshot;
});

export const codexPtyStatusStrategyPlaceholder = {
  id: "codex.ptyStatus",
  kind: "cli" as const,
  isAvailable: Effect.succeed(false),
  fetch: Effect.fail(new Error("PTY strategy is not enabled in v1.")),
  shouldFallback: () => false,
};
