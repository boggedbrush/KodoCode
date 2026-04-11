import type { ProviderKind } from "@t3tools/contracts";

export interface ProviderUsageMetadata {
  readonly id: ProviderKind;
  readonly displayName: string;
  readonly sessionLabel: string;
  readonly weeklyLabel: string;
  readonly supportsCredits: boolean;
  readonly supportsOpus: boolean;
  readonly cliName: string;
  readonly defaultEnabled: boolean;
  readonly usesAccountFallback: boolean;
  readonly usageUrl?: string;
  readonly dashboardUrl?: string;
  readonly dashboardLabel?: string;
  readonly statusPageUrl?: string;
}

export const PROVIDER_USAGE_METADATA: Record<ProviderKind, ProviderUsageMetadata> = {
  codex: {
    id: "codex",
    displayName: "Codex",
    sessionLabel: "Session",
    weeklyLabel: "Weekly",
    supportsCredits: true,
    supportsOpus: false,
    cliName: "codex",
    defaultEnabled: true,
    usesAccountFallback: true,
    usageUrl: "https://chatgpt.com/codex/cloud/settings/usage",
    dashboardUrl: "https://chatgpt.com/codex/cloud",
    dashboardLabel: "Codex Cloud",
    statusPageUrl: "https://status.openai.com",
  },
  claudeAgent: {
    id: "claudeAgent",
    displayName: "Claude",
    sessionLabel: "Session",
    weeklyLabel: "Weekly",
    supportsCredits: false,
    supportsOpus: true,
    cliName: "claude",
    defaultEnabled: false,
    usesAccountFallback: false,
    dashboardUrl: "https://claude.ai/code/",
    dashboardLabel: "Claude Cloud",
    usageUrl: "https://claude.ai/settings/usage",
    statusPageUrl: "https://status.anthropic.com",
  },
};

export const PROVIDER_USAGE_ORDER: ReadonlyArray<ProviderKind> = ["codex", "claudeAgent"];
