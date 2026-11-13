import { describe, expect, it } from "vite-plus/test";

import {
  isKodoOrchestratorWorkerLineage,
  kodoOrchestratorState,
  kodoOrchestratorWorkerActivity,
  kodoOrchestratorUnavailableReason,
  latestKodoOrchestratorThreadId,
} from "./kodoOrchestrator.ts";

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

describe("the dot with its workers", () => {
  const worker = (over: Record<string, unknown> = {}, parent = "kodo-orchestrator") => ({
    lineage: { parentThreadId: parent, relationshipToParent: "subagent" },
    runtime: { status: "running" },
    ...over,
  });

  it("is working while a worker runs, though the Orchestrator itself is idle", () => {
    const idle = { runtime: { status: "idle" } };
    const workers = kodoOrchestratorWorkerActivity([worker()], "kodo-orchestrator");
    expect(workers).toEqual({ live: 1, needsYou: false });
    expect(kodoOrchestratorState(idle, workers)).toBe("working");
    expect(
      kodoOrchestratorState(idle, kodoOrchestratorWorkerActivity([], "kodo-orchestrator")),
    ).toBe("idle");
  });

  it("needs you when a worker waits on a person, above everything it is doing", () => {
    for (const ask of [{ hasPendingApprovals: true }, { hasPendingUserInput: true }]) {
      const workers = kodoOrchestratorWorkerActivity(
        [worker({ runtime: { status: "waiting" }, ...ask })],
        "kodo-orchestrator",
      );
      expect(kodoOrchestratorState({ runtime: { status: "running" } }, workers)).toBe("needs-you");
    }
  });

  it("counts only the workers of this conversation, and none that finished", () => {
    const workers = kodoOrchestratorWorkerActivity(
      [
        worker({ runtime: { status: "completed" } }),
        worker({}, "someone-else"),
        {
          lineage: { parentThreadId: "kodo-orchestrator", relationshipToParent: "fork" },
          runtime: { status: "running" },
        },
        worker({}, "kodo-orchestrator-2"),
      ],
      "kodo-orchestrator-2",
    );
    expect(workers).toEqual({ live: 1, needsYou: false });
    expect(kodoOrchestratorWorkerActivity([worker()], undefined)).toEqual({
      live: 0,
      needsYou: false,
    });
  });
});

describe("which conversation is the Orchestrator's, and which threads are its workers", () => {
  it("is the newest of its series", () => {
    expect(latestKodoOrchestratorThreadId(["a", "kodo-orchestrator"])).toBe("kodo-orchestrator");
    expect(
      latestKodoOrchestratorThreadId([
        "kodo-orchestrator-2",
        "kodo-orchestrator",
        "kodo-orchestrator-10",
      ]),
    ).toBe("kodo-orchestrator-10");
    expect(latestKodoOrchestratorThreadId(["a", "kodo-orchestrator-x"])).toBeUndefined();
  });

  it("lists a subagent of it, and nothing else", () => {
    const lineage = (parentThreadId: string | null, relationshipToParent: string | null) => ({
      parentThreadId: parentThreadId as never,
      relationshipToParent: relationshipToParent as never,
    });
    expect(isKodoOrchestratorWorkerLineage(lineage("kodo-orchestrator", "subagent"))).toBe(true);
    expect(isKodoOrchestratorWorkerLineage(lineage("kodo-orchestrator-3", "subagent"))).toBe(true);
    expect(isKodoOrchestratorWorkerLineage(lineage("kodo-orchestrator", "fork"))).toBe(false);
    expect(isKodoOrchestratorWorkerLineage(lineage("another", "subagent"))).toBe(false);
    expect(isKodoOrchestratorWorkerLineage(lineage(null, "subagent"))).toBe(false);
  });
});

describe("why the Orchestrator cannot open", () => {
  const provider = (support: { support: "full" | "none"; reason?: string }) =>
    ({
      instanceId: "acp-agent",
      displayName: "Some agent",
      driver: "acp",
      kodoSubAgents: support,
    }) as never;

  it("is the missing default model, then a provider that cannot receive the T3 tools, else nothing", () => {
    expect(kodoOrchestratorUnavailableReason({ model: null, providers: [] })).toContain(
      "default model",
    );
    const model = { instanceId: "acp-agent" } as never;
    expect(
      kodoOrchestratorUnavailableReason({
        model,
        providers: [provider({ support: "none", reason: "No tools reach it." })],
      }),
    ).toBe(
      "The Orchestrator can't run on Some agent. No tools reach it. Change its model in Settings.",
    );
    expect(
      kodoOrchestratorUnavailableReason({ model, providers: [provider({ support: "full" })] }),
    ).toBeNull();
    // A provider the server has not listed yet cannot be judged here.
    expect(kodoOrchestratorUnavailableReason({ model, providers: [] })).toBeNull();
  });
});
