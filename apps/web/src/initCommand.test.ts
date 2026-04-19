import type { ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  countAvailableHarnesses,
  getCompanionGuideFile,
  getGuideFileForProvider,
  INIT_COMMAND_TEMPLATE,
} from "./initCommand";

function makeProvider(
  overrides: Partial<ServerProvider> & Pick<ServerProvider, "provider">,
): ServerProvider {
  return {
    provider: overrides.provider,
    enabled: overrides.enabled ?? true,
    installed: overrides.installed ?? true,
    version: overrides.version ?? null,
    status: overrides.status ?? "ready",
    auth: overrides.auth ?? { status: "authenticated" },
    checkedAt: overrides.checkedAt ?? "2026-04-19T00:00:00.000Z",
    message: overrides.message,
    models: overrides.models ?? [],
  };
}

describe("initCommand", () => {
  it("maps providers to the expected guide file", () => {
    expect(getGuideFileForProvider("codex")).toBe("AGENTS.md");
    expect(getGuideFileForProvider("claudeAgent")).toBe("CLAUDE.md");
  });

  it("returns the opposite guide file as the companion", () => {
    expect(getCompanionGuideFile("AGENTS.md")).toBe("CLAUDE.md");
    expect(getCompanionGuideFile("CLAUDE.md")).toBe("AGENTS.md");
  });

  it("counts only enabled and installed harnesses", () => {
    expect(
      countAvailableHarnesses([
        makeProvider({ provider: "codex", enabled: true, installed: true }),
        makeProvider({ provider: "claudeAgent", enabled: true, installed: false }),
      ]),
    ).toBe(1);
  });

  it("ships a starter template with the expected sections", () => {
    expect(INIT_COMMAND_TEMPLATE).toContain("# Repository Guidelines");
    expect(INIT_COMMAND_TEMPLATE).toContain("## Build, Test, and Development Commands");
    expect(INIT_COMMAND_TEMPLATE).toContain("## Operational Notes");
  });
});
