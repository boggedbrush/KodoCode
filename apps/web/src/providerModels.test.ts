import { describe, expect, it } from "vitest";
import type { ServerProviderModel } from "@t3tools/contracts";

import { getProviderModelCapabilities } from "./providerModels";

const DEFAULT_CAPABILITIES = {
  reasoningEffortLevels: [{ value: "medium", label: "Medium", isDefault: true }],
  supportsFastMode: false,
  supportsThinkingToggle: true,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
} as const;

describe("getProviderModelCapabilities", () => {
  it("resolves auto to the provider default model capabilities", () => {
    const models: ReadonlyArray<ServerProviderModel> = [
      {
        slug: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        isCustom: false,
        capabilities: DEFAULT_CAPABILITIES,
      },
      {
        slug: "custom-preview-model",
        name: "Custom Preview",
        isCustom: true,
        capabilities: {
          reasoningEffortLevels: [],
          supportsFastMode: true,
          supportsThinkingToggle: false,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
    ];

    expect(getProviderModelCapabilities(models, "auto", "claudeAgent")).toEqual(
      DEFAULT_CAPABILITIES,
    );
  });
});
