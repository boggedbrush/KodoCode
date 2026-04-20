import type { ProviderKind } from "@t3tools/contracts";

export interface ProviderUsageMetadata {
  readonly id: ProviderKind;
  readonly displayName: string;
  readonly sessionLabel: string;
  readonly weeklyLabel: string;
  readonly dashboardUrl?: string;
  readonly dashboardLabel?: string;
  readonly statusPageUrl?: string;
  readonly usageUrl?: string;
}

export const PROVIDER_USAGE_METADATA: Partial<Record<ProviderKind, ProviderUsageMetadata>> = {
  codex: {
    id: "codex",
    displayName: "Codex",
    sessionLabel: "Session",
    weeklyLabel: "Weekly",
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
    dashboardUrl: "https://claude.ai/code/",
    dashboardLabel: "Claude Cloud",
    usageUrl: "https://claude.ai/settings/usage",
    statusPageUrl: "https://status.anthropic.com",
  },
};

export const PROVIDER_USAGE_ORDER: ReadonlyArray<ProviderKind> = ["codex", "claudeAgent"];
