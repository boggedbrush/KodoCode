import { PlanId, RunId, ThreadId, type OrchestrationV2PlanArtifact } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  advanceKodoPlanEpoch,
  buildPlanAcceptanceTurn,
  findActionableProposedPlan,
  findResponsePlanOffer,
  resolveKodoPlanOffer,
  responseTitle,
  runKodoPlanAcceptance,
  shouldOfferPlanAcceptance,
  type KodoPlanOffer,
  type PlanAcceptanceStep,
} from "./planAccept.logic";

const plan = (
  id: string,
  runId: string | null,
  status: "draft" | "active" | "completed" | "superseded",
  markdown = `# Plan ${id}\n\n- step`,
) =>
  ({
    id: PlanId.make(id),
    threadId: ThreadId.make("thread-1"),
    runId: runId === null ? null : RunId.make(runId),
    nodeId: "node-1",
    status,
    kind: "proposed_plan",
    markdown,
  }) as unknown as OrchestrationV2PlanArtifact;

const runs = [
  { id: "run-1", ordinal: 1 },
  { id: "run-2", ordinal: 2 },
  { id: "run-3", ordinal: 3 },
];

const find = (
  plans: ReadonlyArray<OrchestrationV2PlanArtifact>,
  latestRunId: string | null,
  cutoffOrdinal: number | null = null,
) => findActionableProposedPlan({ plans, latestRunId, runs, cutoffOrdinal });

describe("kodo plan artifact offers", () => {
  it("picks the newest active proposed plan, preferring the latest run's", () => {
    const plans = [
      plan("a", "run-1", "active"),
      plan("b", "run-2", "active"),
      plan("c", "run-2", "completed"),
    ];
    expect(find(plans, "run-1")?.id).toBe("a");
    expect(find(plans, "run-2")?.id).toBe("b");
    expect(find(plans, null)?.id).toBe("b");
    expect(find([plan("c", "run-2", "superseded")], "run-2")).toBeNull();
  });

  it("ignores todo lists", () => {
    const todo = {
      ...plan("t", "run-1", "active"),
      kind: "todo_list",
    } as unknown as OrchestrationV2PlanArtifact;
    expect(find([todo], "run-1")).toBeNull();
  });

  it("never offers a plan from a run that came before the thread entered Plan", () => {
    // An Ask answer captured as a plan by run-2; the thread was switched to Plan after it.
    const plans = [plan("ask-answer", "run-2", "active")];
    expect(find(plans, "run-2", 2)).toBeNull();
    expect(find(plans, "run-3", 2)).toBeNull();
    // A plan from a later run is offered; so is any plan while the start of Plan is unknown.
    expect(find([...plans, plan("real", "run-3", "active")], "run-3", 2)?.id).toBe("real");
    expect(find(plans, "run-2", null)?.id).toBe("ask-answer");
  });

  it("trusts a run's recorded mode over the client's cutoff guess", () => {
    const recorded = [
      { id: "run-1", ordinal: 1, interactionMode: "plan" as const },
      { id: "run-2", ordinal: 2, interactionMode: "ask" as const },
      { id: "run-3", ordinal: 3 },
    ];
    const offerFor = (runId: string, cutoffOrdinal: number | null) =>
      findActionableProposedPlan({
        plans: [plan("p", runId, "active")],
        latestRunId: runId,
        runs: recorded,
        cutoffOrdinal,
      });
    // Planned before the guessed cutoff, and still a plan; asked after it, and not one.
    expect(offerFor("run-1", 2)?.id).toBe("p");
    expect(offerFor("run-2", null)).toBeNull();
    expect(offerFor("run-2", 1)).toBeNull();
    // A run without a record falls back to the cutoff.
    expect(offerFor("run-3", 2)?.id).toBe("p");
    expect(offerFor("run-3", 3)).toBeNull();
  });

  it("drops a plan with no run once the start of Plan is known", () => {
    expect(find([plan("orphan", null, "active")], null, 1)).toBeNull();
    expect(find([plan("orphan", null, "active")], null, null)?.id).toBe("orphan");
  });
});

describe("kodo plan epoch", () => {
  it("starts unknown, then cuts off at the newest run when the thread enters Plan", () => {
    const first = advanceKodoPlanEpoch(undefined, { mode: "ask", latestRunOrdinal: 4 });
    expect(first).toEqual({ seenMode: "ask", cutoffOrdinal: null });
    const entered = advanceKodoPlanEpoch(first, { mode: "plan", latestRunOrdinal: 4 });
    expect(entered).toEqual({ seenMode: "plan", cutoffOrdinal: 4 });
  });

  it("keeps the cutoff while the thread stays in Plan and runs accumulate", () => {
    const entered = { seenMode: "plan" as const, cutoffOrdinal: 4 };
    expect(advanceKodoPlanEpoch(entered, { mode: "plan", latestRunOrdinal: 9 })).toBe(entered);
  });

  it("moves the cutoff when the thread leaves and re-enters Plan", () => {
    const entered = { seenMode: "plan" as const, cutoffOrdinal: 4 };
    const left = advanceKodoPlanEpoch(entered, { mode: "code", latestRunOrdinal: 6 });
    expect(left.seenMode).toBe("code");
    expect(advanceKodoPlanEpoch(left, { mode: "plan", latestRunOrdinal: 7 }).cutoffOrdinal).toBe(7);
  });

  it("does not gate a thread first seen already in Plan", () => {
    expect(advanceKodoPlanEpoch(undefined, { mode: "plan", latestRunOrdinal: 3 })).toEqual({
      seenMode: "plan",
      cutoffOrdinal: null,
    });
  });
});

describe("kodo plan fallback for providers with no plan artifact", () => {
  const latestRun = (
    overrides: Partial<{ status: string; assistantMessageId: string | null }>,
  ) => ({
    runId: "run-3",
    status: "completed",
    assistantMessageId: "message-3" as string | null,
    ...overrides,
  });
  const offer = (
    run: ReturnType<typeof latestRun> | null,
    cutoffOrdinal: number | null = 2,
    text: string | null = "## Plan\n\n1. do it",
  ) =>
    findResponsePlanOffer({
      latestRun: run,
      runs,
      cutoffOrdinal,
      messageText: () => text,
    });

  it("offers the settled reply of a run that came after Plan began", () => {
    expect(offer(latestRun({}))).toEqual({
      kind: "response",
      key: "run:run-3",
      runId: "run-3",
      messageId: "message-3",
      title: "Plan",
    });
  });

  it("offers nothing without a finished run, a reply, text, or after a Plan start it predates", () => {
    expect(offer(null)).toBeNull();
    expect(offer(latestRun({ status: "running" }))).toBeNull();
    expect(offer(latestRun({ status: "failed" }))).toBeNull();
    expect(offer(latestRun({ status: "interrupted" }))).toBeNull();
    expect(offer(latestRun({ assistantMessageId: null }))).toBeNull();
    expect(offer(latestRun({}), 2, "   ")).toBeNull();
    expect(offer(latestRun({}), 3)).toBeNull();
    expect(offer(latestRun({}), null)?.runId).toBe("run-3");
  });

  it("prefers a proposed-plan artifact and falls back only when there is none", () => {
    const base = {
      runs,
      latestRun: latestRun({}),
      cutoffOrdinal: 2,
      messageText: () => "Reply",
    };
    expect(resolveKodoPlanOffer({ ...base, plans: [plan("p", "run-3", "active")] })?.kind).toBe(
      "artifact",
    );
    expect(resolveKodoPlanOffer({ ...base, plans: [] })?.kind).toBe("response");
    // An Ask-era artifact does not suppress the fallback, and is not offered itself.
    const stale = resolveKodoPlanOffer({ ...base, plans: [plan("old", "run-2", "active")] });
    expect(stale?.kind).toBe("response");
  });

  it("titles a reply only by a leading markdown heading", () => {
    expect(responseTitle("\n# Add the picker\n\nmore")).toBe("Add the picker");
    expect(responseTitle("Here is the plan:\n# Later heading")).toBeNull();
    expect(responseTitle("1. First step")).toBeNull();
    expect(responseTitle("todo list fixture complete")).toBeNull();
    expect(responseTitle("   ")).toBeNull();
    expect(responseTitle(`# ${"x".repeat(200)}`)).toHaveLength(80);
  });
});

const artifactOffer = find([plan("a", "run-1", "active")], "run-1")!;

describe("kodo plan acceptance offer", () => {
  const base = {
    interactionMode: "plan" as const,
    latestRunSettled: true,
    pendingUserInputCount: 0,
    offer: artifactOffer as KodoPlanOffer | null,
    dismissedOfferKey: null as string | null,
    canOperateThread: true,
  };

  it("offers approval only in Plan mode, idle, with no open question, until dismissed", () => {
    expect(shouldOfferPlanAcceptance(base)).toBe(true);
    expect(shouldOfferPlanAcceptance({ ...base, interactionMode: "code" })).toBe(false);
    expect(shouldOfferPlanAcceptance({ ...base, interactionMode: "default" })).toBe(false);
    expect(shouldOfferPlanAcceptance({ ...base, interactionMode: "ask" })).toBe(false);
    expect(shouldOfferPlanAcceptance({ ...base, interactionMode: "review" })).toBe(false);
    expect(shouldOfferPlanAcceptance({ ...base, latestRunSettled: false })).toBe(false);
    expect(shouldOfferPlanAcceptance({ ...base, pendingUserInputCount: 1 })).toBe(false);
    expect(shouldOfferPlanAcceptance({ ...base, offer: null })).toBe(false);
    expect(shouldOfferPlanAcceptance({ ...base, dismissedOfferKey: artifactOffer.key })).toBe(
      false,
    );
    expect(shouldOfferPlanAcceptance({ ...base, dismissedOfferKey: "plan:other" })).toBe(true);
  });

  it("hides the offer from someone who cannot operate the thread", () => {
    expect(shouldOfferPlanAcceptance({ ...base, canOperateThread: false })).toBe(false);
  });
});

describe("kodo plan acceptance turn", () => {
  it("implements an artifact plan as a Code turn linked to the plan", () => {
    const offer = find([plan("a", "run-1", "active", "# Ship it\n\n1. do\n")], "run-1")!;
    expect(buildPlanAcceptanceTurn({ threadId: ThreadId.make("thread-1"), offer })).toEqual({
      text: "PLEASE IMPLEMENT THIS PLAN:\n# Ship it\n\n1. do",
      interactionMode: "code",
      sourceProposedPlan: { threadId: "thread-1", planId: "a" },
    });
  });

  it("tells the agent to implement the plan it just presented when there is no artifact", () => {
    const turn = buildPlanAcceptanceTurn({
      threadId: ThreadId.make("thread-1"),
      offer: {
        kind: "response",
        key: "run:run-3",
        runId: "run-3",
        messageId: "message-3",
        title: null,
      },
    });
    expect(turn.interactionMode).toBe("code");
    expect(turn.sourceProposedPlan).toBeUndefined();
    expect(turn.text).toMatch(/plan you just presented/);
  });
});

describe("kodo plan acceptance run", () => {
  const ok: PlanAcceptanceStep = { ok: true };
  const fail = (message: string, interrupted = false): PlanAcceptanceStep => ({
    ok: false,
    message,
    interrupted,
  });
  const run = (
    overrides: Partial<{
      stillOffered: boolean;
      switchToCode: PlanAcceptanceStep;
      startTurn: PlanAcceptanceStep;
      returnToPlan: PlanAcceptanceStep;
    }> = {},
  ) => {
    const calls: string[] = [];
    const step = (name: string, result: PlanAcceptanceStep) => async () => {
      calls.push(name);
      return result;
    };
    const outcome = runKodoPlanAcceptance({
      stillOffered: () => overrides.stillOffered ?? true,
      switchToCode: step("code", overrides.switchToCode ?? ok),
      startTurn: step("start", overrides.startTurn ?? ok),
      returnToPlan: step("plan", overrides.returnToPlan ?? ok),
    });
    return { calls, outcome };
  };

  it("switches to Code, then starts the turn", async () => {
    const { calls, outcome } = run();
    expect(await outcome).toEqual({ status: "started" });
    expect(calls).toEqual(["code", "start"]);
  });

  it("does nothing when the offer no longer stands at click time", async () => {
    const { calls, outcome } = run({ stillOffered: false });
    expect(await outcome).toEqual({ status: "skipped" });
    expect(calls).toEqual([]);
  });

  it("leaves the thread in Plan when the switch to Code fails", async () => {
    const { calls, outcome } = run({ switchToCode: fail("nope") });
    expect(await outcome).toEqual({ status: "failed", stage: "mode", message: "nope" });
    expect(calls).toEqual(["code"]);
  });

  it("returns the thread to Plan when Code was saved but the turn did not start", async () => {
    const { calls, outcome } = run({ startTurn: fail("provider offline") });
    expect(await outcome).toEqual({
      status: "failed",
      stage: "turn",
      message: "provider offline",
    });
    expect(calls).toEqual(["code", "start", "plan"]);
  });

  it("says so when the return to Plan fails as well", async () => {
    const { outcome } = run({ startTurn: fail("provider offline"), returnToPlan: fail("socket") });
    const result = await outcome;
    expect(result).toMatchObject({ status: "failed", stage: "turn" });
    expect(result.status === "failed" ? result.message : "").toBe(
      "provider offline The thread also could not return to Plan: socket",
    );
  });

  it("reports nothing for an interrupted command, but still rolls back", async () => {
    const { calls, outcome } = run({ startTurn: fail("", true) });
    expect(await outcome).toEqual({ status: "failed", stage: "turn", message: null });
    expect(calls).toEqual(["code", "start", "plan"]);
    const switched = run({ switchToCode: fail("", true) });
    expect(await switched.outcome).toEqual({ status: "failed", stage: "mode", message: null });
  });

  it("checks the offer once, before any command", async () => {
    const stillOffered = vi.fn(() => true);
    await runKodoPlanAcceptance({
      stillOffered,
      switchToCode: async () => ok,
      startTurn: async () => ok,
      returnToPlan: async () => ok,
    });
    expect(stillOffered).toHaveBeenCalledTimes(1);
  });
});
