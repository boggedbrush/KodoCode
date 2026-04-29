import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { query as claudeQuery } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderUsageState, ServerProviderUsageWindow } from "@t3tools/contracts";
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
import { makePtyApi, makeSubprocessApi } from "../hostApis";
import {
  defaultIdentity,
  findStringByKeys,
  mergeUsageWindows,
  parseRateLimitWindows,
} from "./runtimeUsageParsing";

const PROVIDER = "claudeAgent" as const;
const CLAUDE_OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_OAUTH_BETA_HEADER = "oauth-2025-04-20";
const CLAUDE_CREDENTIALS_FILE = ".credentials.json";
const ESC = String.fromCharCode(27);
const CSI = String.fromCharCode(155);
const BEL = String.fromCharCode(7);
const ANSI_ESCAPE_PATTERN = new RegExp(
  `[${ESC}${CSI}][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?${BEL})|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))`,
  "g",
);
const CURSOR_FORWARD_PATTERN = new RegExp(`${ESC}\\[(\\d*)C`, "g");

interface ClaudeOAuthCredentials {
  readonly accessToken: string;
  readonly planName: string | null;
}

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

function stripAnsiForParsing(value: string): string {
  return value
    .replace(CURSOR_FORWARD_PATTERN, (_, count: string) => " ".repeat(Number(count || "1")))
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/\r/g, "\n");
}

function normalizeCliLine(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\bRese\s+s\b/i, "Resets")
    .trim();
}

function parsePercentUsed(line: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*%\s*(used|remaining|left)/i.exec(line);
  if (!match) {
    return null;
  }

  const value = Math.max(0, Math.min(100, Number(match[1])));
  return match[2]?.toLowerCase() === "used" ? value : 100 - value;
}

function parseClaudeCliResetAt(line: string, now: Date = new Date()): string | null {
  const normalized = normalizeCliLine(line);
  if (!/^Resets?\b/i.test(normalized)) {
    return null;
  }

  const relative = /\b(\d+)\s*([mhd])\b/i.exec(normalized);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2]?.toLowerCase();
    const multiplier = unit === "d" ? 86_400_000 : unit === "h" ? 3_600_000 : 60_000;
    return new Date(now.getTime() + amount * multiplier).toISOString();
  }

  const absoluteText = normalized
    .replace(/^Resets?\s+/i, "")
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\bat\b/gi, "")
    .trim();
  const absolute = Date.parse(absoluteText);
  if (!Number.isNaN(absolute)) {
    return new Date(absolute).toISOString();
  }

  const withYear = Date.parse(`${absoluteText} ${now.getFullYear()}`);
  if (!Number.isNaN(withYear)) {
    const parsed = new Date(withYear);
    if (parsed.getTime() < now.getTime() - 86_400_000) {
      parsed.setFullYear(parsed.getFullYear() + 1);
    }
    return parsed.toISOString();
  }

  const monthTime = /^([A-Za-z]+)\s+(\d{1,2})\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(
    absoluteText,
  );
  if (monthTime) {
    const parsed = new Date(
      `${monthTime[1]} ${monthTime[2]} ${now.getFullYear()} ${monthTime[3]}:${monthTime[4] ?? "00"} ${monthTime[5] ?? ""}`,
    );
    if (!Number.isNaN(parsed.getTime())) {
      if (parsed.getTime() < now.getTime() - 86_400_000) {
        parsed.setFullYear(parsed.getFullYear() + 1);
      }
      return parsed.toISOString();
    }
  }

  return null;
}

function parseClaudeCliWindow(input: {
  readonly lines: ReadonlyArray<string>;
  readonly headerPattern: RegExp;
  readonly key: string;
  readonly label: string;
  readonly now?: Date;
}): ServerProviderUsageWindow | null {
  const headerIndex = input.lines.findIndex((line) => input.headerPattern.test(line));
  if (headerIndex === -1) {
    return null;
  }

  const nearbyLines = input.lines.slice(headerIndex + 1, headerIndex + 8);
  let percentUsed: number | null = null;
  let resetAt: string | null = null;
  for (const line of nearbyLines) {
    percentUsed ??= parsePercentUsed(line);
    resetAt ??= parseClaudeCliResetAt(line, input.now);
  }

  if (percentUsed === null && resetAt === null) {
    return null;
  }

  return {
    key: input.key,
    label: input.label,
    percentUsed,
    resetAt,
  };
}

export function parseClaudeCliUsageOutput(
  stdout: string,
  now = new Date(),
): ReadonlyArray<ServerProviderUsageWindow> {
  const lines = stripAnsiForParsing(stdout)
    .split("\n")
    .map(normalizeCliLine)
    .filter((line) => line.length > 0);

  const sessionWindow = parseClaudeCliWindow({
    lines,
    headerPattern: /^Current session$/i,
    key: "claude-cli-session",
    label: PROVIDER_USAGE_METADATA.claudeAgent.sessionLabel,
    now,
  });
  const weeklyWindow = parseClaudeCliWindow({
    lines,
    headerPattern: /^Current week\b/i,
    key: "claude-cli-weekly",
    label: PROVIDER_USAGE_METADATA.claudeAgent.weeklyLabel,
    now,
  });

  return [sessionWindow, weeklyWindow].filter((window) => window !== null);
}

function usageStateFromWindows(
  windows: ReadonlyArray<ServerProviderUsageWindow>,
): ProviderUsageState {
  return windows.some((window) => window.percentUsed !== null && window.percentUsed >= 100)
    ? "exhausted"
    : windows.some((window) => window.percentUsed !== null && window.percentUsed >= 80)
      ? "limited"
      : windows.length > 0
        ? "ready"
        : "unknown";
}

function resolveClaudeCredentialsPaths(): ReadonlyArray<string> {
  const configRoots = (process.env.CLAUDE_CONFIG_DIR ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return [
    ...configRoots.map((root) => join(root, CLAUDE_CREDENTIALS_FILE)),
    join(homedir(), ".claude", CLAUDE_CREDENTIALS_FILE),
  ];
}

const readClaudeOAuthCredentialsFile = Effect.tryPromise(
  async (): Promise<ClaudeOAuthCredentials> => {
    const errors: Array<string> = [];
    for (const credentialsPath of resolveClaudeCredentialsPaths()) {
      try {
        const raw = await readFile(credentialsPath, "utf8");
        const credentials = parseClaudeOAuthCredentials(raw);
        if (credentials.accessToken) {
          return {
            accessToken: credentials.accessToken,
            planName: credentials.planName,
          };
        }
        errors.push(`${credentialsPath}: access token not found`);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          continue;
        }
        errors.push(
          `${credentialsPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    throw new Error(
      errors.length > 0
        ? `Claude OAuth credentials file could not be read. ${errors.join("; ")}`
        : "Claude OAuth credentials file not found.",
    );
  },
).pipe(Effect.mapError(toError));

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
  const pty = yield* makePtyApi;
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

  const claudeOAuthFileUsageStrategy = {
    id: "claude.oauthFileUsage",
    kind: "oauth" as const,
    isAvailable: claudeSettings.pipe(
      Effect.map((settings) => settings.enabled),
      Effect.catch(() => Effect.succeed(false)),
    ),
    fetch: readClaudeOAuthCredentialsFile.pipe(
      Effect.flatMap((credentials) =>
        fetchClaudeOAuthUsage(credentials.accessToken).pipe(
          Effect.map((payload) => ({
            sourceLabel: "oauth-file-usage",
            usage: snapshotFromOAuthUsage({
              payload,
              planName: credentials.planName,
            }),
          })),
        ),
      ),
    ),
    shouldFallback: (error: Error) => !isCommandMissingCause(error),
  };

  const claudeCliUsageStrategy = {
    id: "claude.cliUsage",
    kind: "cli" as const,
    isAvailable: claudeSettings.pipe(
      Effect.map((settings) => settings.enabled),
      Effect.catch(() => Effect.succeed(false)),
    ),
    fetch: claudeSettings.pipe(
      Effect.flatMap((providerSettings) =>
        pty.runInteractive({
          command: providerSettings.binaryPath,
          args: ["--allowedTools", ""],
          timeoutMs: 20_000,
          sendAfterMs: [{ delayMs: 3_000, send: "/usage\r" }],
          stopOnSubstring: ["Extra usage"],
        }),
      ),
      Effect.flatMap((result) => {
        const windows = parseClaudeCliUsageOutput(result.stdout);
        if (windows.length === 0) {
          return Effect.fail(new Error("Claude CLI usage windows not found."));
        }
        const status = usageStateFromWindows(windows);
        return Effect.succeed({
          sourceLabel: "cli-usage",
          usage: {
            provider: PROVIDER,
            checkedAt: nowIso(),
            status,
            summary:
              status === "exhausted"
                ? "Claude usage exhausted"
                : status === "limited"
                  ? "Claude usage limited"
                  : "Claude usage healthy",
            detail: null,
            resetAt: windows.find((window) => window.resetAt !== null)?.resetAt ?? null,
            identity: defaultIdentity(),
            windows,
          } satisfies ProviderUsageSnapshot,
        });
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
    strategies: [
      claudeOAuthUsageStrategy,
      claudeOAuthFileUsageStrategy,
      claudeCliUsageStrategy,
      claudeAuthStatusStrategy,
      claudeSdkProbeStrategy,
    ],
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
