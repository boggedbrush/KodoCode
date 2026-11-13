import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";

import { ENFORCEMENT_BY_DRIVER } from "../interactionMode.ts";
import {
  KODO_SUB_AGENTS_SUPPORT_BY_DRIVER,
  kodoDriversMissingSubAgentsSupport,
  kodoLeadSupportRefusal,
  kodoSubAgentsSupportForDriver,
  withKodoSubAgents,
} from "./leadSupport.ts";

describe("which providers can lead sub-agents", () => {
  it("has an answer for every driver that read-only enforcement knows", () => {
    expect(kodoDriversMissingSubAgentsSupport()).toEqual([]);
    expect(Object.keys(KODO_SUB_AGENTS_SUPPORT_BY_DRIVER).toSorted()).toEqual(
      Object.keys(ENFORCEMENT_BY_DRIVER).toSorted(),
    );
  });

  it("says a driver it does not know cannot, with the reason", () => {
    expect(kodoSubAgentsSupportForDriver("someNewAgent")).toMatchObject({
      support: "none",
      reason: expect.stringContaining("not known to receive"),
    });
  });

  it("says plainly that an ACP agent's use of the tools is known only once it runs", () => {
    for (const driver of ["acp", "acpRegistry", "grok", "kiro", "fx", "antigravity"]) {
      const support = kodoSubAgentsSupportForDriver(driver);
      expect(support.support, driver).toBe("full");
      expect(support.note, driver).toMatch(/only known once it runs/);
    }
    for (const driver of ["claudeAgent", "codex", "cursor", "opencode", "pi", "muse"]) {
      expect(kodoSubAgentsSupportForDriver(driver), driver).toEqual({ support: "full" });
    }
  });

  it("is put on a provider's status by its driver", () => {
    expect(withKodoSubAgents({ driver: "codex" as never }).kodoSubAgents).toEqual({
      support: "full",
    });
  });

  it("refuses a thread whose provider is missing, unknown, or an OpenCode instance on an external server", () => {
    const provider = (driver: string) => ({
      driver: driver as never,
      instanceId: ProviderInstanceId.make(driver),
      displayName: driver,
    });
    expect(kodoLeadSupportRefusal({ provider: undefined })).toMatch(/not available/);
    expect(kodoLeadSupportRefusal({ provider: provider("nope") })).toMatch(/not known to receive/);
    expect(kodoLeadSupportRefusal({ provider: provider("codex") })).toBeUndefined();
    expect(kodoLeadSupportRefusal({ provider: provider("opencode") })).toBeUndefined();
    expect(
      kodoLeadSupportRefusal({ provider: provider("opencode"), externalOpenCode: true }),
    ).toMatch(/external OpenCode server/);
    // Only OpenCode has that case.
    expect(
      kodoLeadSupportRefusal({ provider: provider("codex"), externalOpenCode: true }),
    ).toBeUndefined();
  });
});
