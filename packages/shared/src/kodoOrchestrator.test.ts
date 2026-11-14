import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  isKodoOrchestratorWorkerLineage,
  kodoNeedsYouItems,
  kodoNeedsYouRowView,
  kodoQuietLabel,
  kodoOrchestratorReason,
  kodoOrchestratorState,
  kodoOrchestratorStatusLine,
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
    expect(workers).toEqual({ live: 1, approvals: 0, questions: 0, needsYou: false });
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
    expect(workers).toEqual({ live: 1, approvals: 0, questions: 0, needsYou: false });
    expect(kodoOrchestratorWorkerActivity([worker()], undefined)).toEqual({
      live: 0,
      approvals: 0,
      questions: 0,
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

describe("the line under the Orchestrator's title", () => {
  const NOW = Date.parse("2026-11-14T12:00:00.000Z");
  const at = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));
  const minutesAgo = (mins: number) => at(NOW - mins * 60_000);
  const workers = (over: Partial<ReturnType<typeof kodoOrchestratorWorkerActivity>> = {}) => ({
    live: 0,
    approvals: 0,
    questions: 0,
    needsYou: false,
    ...over,
  });
  const running = (mins: number) => ({
    runtime: { status: "running", activityStartedAt: minutesAgo(mins) },
  });

  it.each([
    ["nothing to say", null, workers(), "Idle"],
    ["no thread yet", undefined, workers(), "Idle"],
    ["a run of a few minutes", running(3), workers(), "Working 3m"],
    ["a run of under a minute", running(0.2), workers(), "Working <1m"],
    ["a long run", running(135), workers(), "Working 2h 15m"],
    ["a run with no start time", { runtime: { status: "running" } }, workers(), "Working"],
    ["a queued run", { runtime: { status: "queued" } }, workers(), "Queued"],
    [
      "its run and two workers",
      running(3),
      workers({ live: 2 }),
      "Working 3m, waiting on 2 workers",
    ],
    ["workers only", { runtime: { status: "idle" } }, workers({ live: 1 }), "Waiting on 1 worker"],
    [
      "its start card",
      { hasPendingApprovals: true, pendingKodoStart: true, ...running(3) },
      workers({ live: 1 }),
      "Start approval",
    ],
    ["its own other approval", { hasPendingApprovals: true }, workers(), "Approval"],
    [
      "a worker's approval",
      running(1),
      workers({ approvals: 1, needsYou: true }),
      "Worker approval",
    ],
    [
      "two workers' approvals",
      null,
      workers({ approvals: 2, needsYou: true }),
      "2 worker approvals",
    ],
    ["a worker's question", null, workers({ questions: 1, needsYou: true }), "Question"],
    ["its own question", { hasPendingUserInput: true }, workers(), "Question"],
    [
      "a worker's own worker asking",
      { pendingSubagentRequest: "approval" },
      workers(),
      "Worker approval",
    ],
    ["a guest message", { pendingGuestMessageCount: 1 }, workers(), "Guest message"],
    [
      "a failed run",
      { runtime: { status: "failed", lastErrorClass: "provider_error" } },
      workers(),
      "Error",
    ],
    [
      "a usage limit with a reset",
      {
        runtime: {
          status: "failed",
          lastErrorClass: "usage_limit",
          usageLimitResetAt: at(NOW + 130 * 60_000),
        },
      },
      workers(),
      "Usage limit, resets in 2h 10m",
    ],
    [
      "a usage limit whose reset has passed",
      {
        runtime: {
          status: "failed",
          lastErrorClass: "usage_limit",
          usageLimitResetAt: minutesAgo(5),
        },
      },
      workers(),
      "Usage limit",
    ],
  ])("reads %s", (_name, thread, activity, expected) => {
    expect(kodoOrchestratorStatusLine(thread, activity, NOW)).toBe(expected);
  });

  it("names the start card before a worker's approval, and an approval before an error", () => {
    expect(
      kodoOrchestratorReason(
        { hasPendingApprovals: true, pendingKodoStart: true },
        workers({ approvals: 1 }),
      ),
    ).toBe("start-approval");
    expect(
      kodoOrchestratorReason({ runtime: { status: "failed" } }, workers({ approvals: 1 })),
    ).toBe("worker-approval");
  });

  it("turns the dot to needs-you for an error or a usage limit, and not for a stopped run", () => {
    expect(kodoOrchestratorState({ runtime: { status: "failed" } })).toBe("needs-you");
    expect(kodoOrchestratorState({ runtime: { status: "interrupted" } })).toBe("idle");
    expect(kodoOrchestratorState({ runtime: { status: "completed" } })).toBe("idle");
  });
});

describe("the Needs you list", () => {
  const shell = (
    id: string,
    over: {
      readonly parent?: string | null;
      readonly relationship?: string;
      readonly lead?: boolean;
    } & Record<string, unknown> = {},
  ) => {
    const { parent = null, relationship = "subagent", lead, ...rest } = over;
    return {
      id,
      title: `Title ${id}`,
      lineage: {
        parentThreadId: parent,
        relationshipToParent: parent === null ? null : relationship,
      },
      ...(lead === true ? { kodoLead: { kind: "sub-agents" } } : {}),
      ...rest,
    };
  };
  const ORCH = "kodo-orchestrator";

  it("lists the Orchestrator, its workers, leads and their workers, and nothing else", () => {
    const items = kodoNeedsYouItems(
      [
        shell(ORCH, { hasPendingApprovals: true, pendingKodoStart: true }),
        shell("w1", { parent: ORCH, hasPendingApprovals: true }),
        shell("lead", { lead: true, hasPendingUserInput: true }),
        shell("lw", { parent: "lead", hasPendingApprovals: true }),
        // An ordinary thread's approval is its own card's business, not this list's.
        shell("plain", { hasPendingApprovals: true }),
        // A fork of the Orchestrator is not its worker.
        shell("fork", { parent: ORCH, relationship: "fork", hasPendingApprovals: true }),
        // A worker of someone else's thread, and a worker of a lead that is not leading.
        shell("stranger", { parent: "plain", hasPendingApprovals: true }),
        shell("quiet-worker", { parent: ORCH }),
      ],
      ORCH,
    );
    expect(items.map((item) => [item.threadId, item.kind, item.role, item.leadTitle])).toEqual([
      [ORCH, "start-approval", "orchestrator", undefined],
      ["lw", "approval", "lead-worker", "Title lead"],
      ["w1", "approval", "orchestrator-worker", undefined],
      ["lead", "question", "lead", undefined],
    ]);
  });

  it("names a worker's own worker asking by what it asks", () => {
    const items = kodoNeedsYouItems(
      [
        shell("w1", { parent: ORCH, pendingSubagentRequest: "approval" }),
        shell("w2", { parent: ORCH, pendingSubagentRequest: "user_input" }),
        shell("w3", { parent: ORCH, pendingSubagentRequest: null }),
      ],
      ORCH,
    );
    expect(items.map((item) => [item.threadId, item.kind])).toEqual([
      ["w1", "approval"],
      ["w2", "question"],
    ]);
  });

  it("counts a worker's request once, on the worker, not again on the threads above it", () => {
    const items = kodoNeedsYouItems(
      [
        shell(ORCH, { pendingSubagentRequest: "approval" }),
        shell("w1", { parent: ORCH, hasPendingApprovals: true }),
        shell("lead", { lead: true, pendingSubagentRequest: "approval" }),
        shell("lw", { parent: "lead", pendingSubagentRequest: "approval" }),
        // A request nothing listed carries is kept on the lead that holds it.
        shell("lead2", { lead: true, pendingSubagentRequest: "approval" }),
      ],
      ORCH,
    );
    expect(items.map((item) => [item.threadId, item.kind])).toEqual([
      ["lead2", "approval"],
      ["lw", "approval"],
      ["w1", "approval"],
    ]);
  });

  it("is empty without an Orchestrator to ask about, but still finds leads", () => {
    expect(
      kodoNeedsYouItems([shell("w1", { parent: ORCH, hasPendingApprovals: true })], undefined),
    ).toEqual([]);
    expect(
      kodoNeedsYouItems([shell("lead", { lead: true, hasPendingApprovals: true })], undefined),
    ).toHaveLength(1);
  });
});

describe("how a Needs you row reads", () => {
  it.each([
    [{ kind: "start-approval", role: "orchestrator" }, "Start approval", "Orchestrator"],
    [{ kind: "approval", role: "orchestrator-worker" }, "Approval", "Worker of the Orchestrator"],
    [{ kind: "question", role: "lead" }, "Question", "Leads sub-agents"],
    [
      { kind: "approval", role: "lead-worker", leadTitle: "Refactor auth" },
      "Approval",
      "Worker of Refactor auth",
    ],
  ] as const)("%j", (partial, label, context) => {
    expect(kodoNeedsYouRowView({ threadId: "t", title: "T", ...partial })).toEqual({
      label,
      context,
    });
  });
});

describe("quiet workers in the Needs you list", () => {
  const worker = (id: string, parent: string, over: Record<string, unknown> = {}) => ({
    id,
    title: `Title ${id}`,
    lineage: { parentThreadId: parent, relationshipToParent: "subagent" },
    ...over,
  });
  const since = "2026-11-14T12:00:00.000Z";

  it("lists a quiet worker of the Orchestrator or of a lead, after what needs an answer", () => {
    const items = kodoNeedsYouItems(
      [
        {
          id: "lead",
          title: "Lead",
          lineage: { parentThreadId: null },
          kodoLead: { kind: "sub-agents" },
        },
        worker("q1", "kodo-orchestrator", { kodoQuiet: { since } }),
        worker("q2", "lead", { kodoQuiet: { since } }),
        worker("a1", "lead", { hasPendingApprovals: true }),
        // A quiet flag on a thread that is nobody's worker is not listed.
        worker("stray", "plain", { kodoQuiet: { since } }),
      ],
      "kodo-orchestrator",
    );
    expect(items.map((item) => [item.threadId, item.kind, item.quietSince])).toEqual([
      ["a1", "approval", undefined],
      ["q1", "quiet", since],
      ["q2", "quiet", since],
    ]);
  });

  it("reads how long a worker has been quiet, in whole minutes", () => {
    const at = Date.parse(since);
    expect(kodoQuietLabel(since, at + 30_000)).toBe("Quiet");
    expect(kodoQuietLabel(since, at + 7 * 60_000 + 59_000)).toBe("Quiet for 7m");
    expect(kodoQuietLabel(since, at + 135 * 60_000)).toBe("Quiet for 2h 15m");
    expect(kodoQuietLabel("garbage", at)).toBe("Quiet");
  });
});
