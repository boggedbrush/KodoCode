import { describe, expect, it } from "vite-plus/test";

import { kodoOrchestratorState } from "./kodoOrchestrator.ts";

describe("the Orchestrator's dot", () => {
  it("is idle before the thread exists, and when nothing runs or waits", () => {
    expect(kodoOrchestratorState(null)).toBe("idle");
    expect(kodoOrchestratorState(undefined)).toBe("idle");
    expect(kodoOrchestratorState({ runtime: { status: "idle" } })).toBe("idle");
    expect(kodoOrchestratorState({ runtime: null })).toBe("idle");
  });

  it.each(["running", "waiting", "preparing", "starting", "queued"])(
    "is working while the runtime is %s",
    (status) => {
      expect(kodoOrchestratorState({ runtime: { status } })).toBe("working");
    },
  );

  it("needs you for whatever waits on a person, above what is running", () => {
    const running = { runtime: { status: "running" } };
    expect(kodoOrchestratorState({ ...running, hasPendingApprovals: true })).toBe("needs-you");
    expect(kodoOrchestratorState({ ...running, hasPendingUserInput: true })).toBe("needs-you");
    // A worker it started asks, and the answer is given in the Orchestrator conversation.
    expect(kodoOrchestratorState({ ...running, pendingSubagentRequest: "approval" })).toBe(
      "needs-you",
    );
    expect(kodoOrchestratorState({ pendingGuestMessageCount: 1 })).toBe("needs-you");
    expect(kodoOrchestratorState({ pendingSubagentRequest: null })).toBe("idle");
  });
});
