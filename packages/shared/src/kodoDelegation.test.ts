import { describe, expect, it } from "@effect/vitest";

import {
  kodoChildThreadFields,
  kodoForkThreadFields,
  kodoSubAgentsToggle,
  kodoThreadLeads,
  kodoThreadModelSlotMode,
} from "./kodoDelegation.ts";

const FULL = { kodoSubAgents: { support: "full" as const } };
const NONE = {
  kodoSubAgents: { support: "none" as const, reason: "No tools reach this provider." },
};
const idle = { busy: false, loopRunning: false, isWorker: false, canOperate: true };
const off = { lead: null, provider: FULL, ...idle };

describe("which model slot a thread's turns read", () => {
  it("is the Orchestrator slot while it leads, else its mode's", () => {
    expect(kodoThreadLeads({ kodoLead: { kind: "sub-agents" } })).toBe(true);
    expect(kodoThreadLeads({ kodoLead: null })).toBe(false);
    expect(kodoThreadLeads(undefined)).toBe(false);
    expect(
      kodoThreadModelSlotMode({ kodoLead: { kind: "sub-agents" }, interactionMode: "code" }),
    ).toBe("orchestrator");
    expect(kodoThreadModelSlotMode({ interactionMode: "plan" })).toBe("plan");
  });
});

describe("whether the sub-agents switch can be flipped", () => {
  it("can on an idle thread whose provider receives the tools", () => {
    expect(kodoSubAgentsToggle(off)).toEqual({ checked: false, disabled: false, reason: null });
    expect(kodoSubAgentsToggle({ ...off, lead: { kind: "sub-agents" } })).toEqual({
      checked: true,
      disabled: false,
      reason: null,
    });
  });

  it.each([
    ["a turn is running", { busy: true }, "current turn finishes"],
    ["a loop is running", { loopRunning: true }, "loop is running"],
    ["the thread is a worker", { isWorker: true }, "workers can't lead"],
    ["the viewer may not operate it", { canOperate: false }, "can't change"],
    ["workers are running", { liveWorkers: 2 }, "Workers are still running"],
  ] as const)("is disabled with its reason when %s", (_name, over, reason) => {
    const toggle = kodoSubAgentsToggle({ ...off, ...over });
    expect(toggle.disabled).toBe(true);
    expect(toggle.reason).toContain(reason);
  });

  it("keeps a switch that is on showing on while it is disabled, so a running turn does not look off", () => {
    expect(kodoSubAgentsToggle({ ...off, lead: { kind: "sub-agents" }, busy: true })).toMatchObject(
      {
        checked: true,
        disabled: true,
      },
    );
  });

  it("is disabled with the server's reason for a provider that cannot receive the tools, and when the server did not say", () => {
    expect(kodoSubAgentsToggle({ ...off, provider: NONE })).toMatchObject({
      disabled: true,
      reason: "No tools reach this provider.",
    });
    expect(kodoSubAgentsToggle({ ...off, provider: undefined })).toMatchObject({ disabled: true });
    expect(kodoSubAgentsToggle({ ...off, provider: {} })).toMatchObject({ disabled: true });
    // An unsupported provider never traps a thread that is already on: it can always be turned off.
    expect(
      kodoSubAgentsToggle({ ...off, provider: NONE, lead: { kind: "sub-agents" } }).disabled,
    ).toBe(false);
  });
});

describe("what a copied thread does not inherit", () => {
  it("never carries a lead, a loop or an applied model into a child", () => {
    expect(kodoChildThreadFields()).toEqual({
      kodoLead: null,
      kodoLoop: undefined,
      kodoModeModel: undefined,
    });
  });

  it("never carries a loop into a fork, and a lead only into a fork a person made", () => {
    expect(kodoForkThreadFields("user")).toEqual({ kodoLoop: undefined });
    for (const createdBy of ["agent", "system"] as const) {
      expect(kodoForkThreadFields(createdBy)).toEqual({ kodoLead: null, kodoLoop: undefined });
    }
  });
});

describe("the Orchestrator's switch and model slot", () => {
  it("reads the Orchestrator slot, like any lead", () => {
    expect(kodoThreadModelSlotMode({ kodoLead: { kind: "swarm" }, interactionMode: "code" })).toBe(
      "orchestrator",
    );
  });

  it("is never offered: it is always read-only", () => {
    expect(
      kodoSubAgentsToggle({
        lead: { kind: "swarm" },
        provider: { kodoSubAgents: { support: "full" } },
        busy: false,
        loopRunning: false,
        isWorker: false,
        canOperate: true,
      }),
    ).toMatchObject({
      checked: false,
      disabled: true,
      reason: "The Orchestrator is always read-only.",
    });
  });
});
