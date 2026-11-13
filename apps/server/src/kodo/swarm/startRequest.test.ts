// KODO: swarm-delegate - the Orchestrator's start question, as the orchestrator records and answers it.
import { describe, expect, it } from "@effect/vitest";
import {
  NodeId,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  isKodoStartRequest,
  kodoStartRequestDecisionRefusal,
  planKodoStartRequestRecord,
  type KodoStartRequestRecordInput,
} from "./startRequest.ts";

const requestId = RuntimeRequestId.make("kodo-start:command:1");
const now = DateTime.makeUnsafe("2026-11-13T00:00:00Z");
const base: KodoStartRequestRecordInput = {
  requestId,
  outcome: "pending",
  prompt: "Project: acme-api",
  reason: "Nothing starts until you approve.",
  threadId: ThreadId.make("kodo-orchestrator"),
  run: {
    id: RunId.make("run:1"),
    rootNodeId: NodeId.make("node:root"),
    providerThreadId: ProviderThreadId.make("provider-thread:1"),
    providerInstanceId: ProviderInstanceId.make("claude"),
  },
  runActive: true,
  commandNodeId: NodeId.make("node:root"),
  providerTurnId: null,
  providerSessionId: ProviderSessionId.make("provider-session:1"),
  turnItemId: TurnItemId.make("item:1"),
  ordinal: 4,
  existing: undefined,
  now,
};

const plan = (over: Partial<KodoStartRequestRecordInput> = {}) =>
  planKodoStartRequestRecord({ ...base, ...over });

describe("raising the Orchestrator's start question", () => {
  it("is an approval request on its own run: a pending request, a waiting node and a card with Approve and Decline", () => {
    const result = plan();
    if (!result.ok) throw new Error(result.cause);
    const [request, node, item] = result.events;
    expect(request).toMatchObject({
      type: "runtime-request.updated",
      payload: {
        id: requestId,
        status: "pending",
        kind: "permission",
        responseCapability: { type: "live", providerSessionId: "provider-session:1" },
      },
    });
    expect(isKodoStartRequest((request as unknown as { payload: never }).payload)).toBe(true);
    expect(node).toMatchObject({
      type: "node.updated",
      payload: { kind: "approval_request", status: "waiting", runtimeRequestId: requestId },
    });
    expect(item).toMatchObject({
      type: "turn-item.updated",
      payload: {
        type: "approval_request",
        status: "waiting",
        requestId,
        prompt: "Project: acme-api",
        options: [{ decision: "decline" }, { decision: "accept" }],
      },
    });
  });

  it("is refused off its run's root, on a run that is not live, or with no session to ask from", () => {
    expect(plan({ commandNodeId: NodeId.make("node:other") })).toMatchObject({ ok: false });
    expect(plan({ runActive: false })).toMatchObject({ ok: false });
    expect(plan({ providerSessionId: null })).toMatchObject({ ok: false });
  });

  it("raises a question once: a second record changes nothing", () => {
    const first = plan();
    if (!first.ok) throw new Error(first.cause);
    const [request] = first.events as unknown as ReadonlyArray<{ payload: never }>;
    expect(
      plan({ existing: { request: request!.payload, node: undefined, item: undefined } }),
    ).toEqual({
      ok: true,
      events: [],
    });
  });

  it("withdraws a pending question everywhere it shows, and leaves an answered one alone", () => {
    const raised = plan();
    if (!raised.ok) throw new Error(raised.cause);
    const [request, node, item] = raised.events as unknown as ReadonlyArray<{ payload: never }>;
    const existing = { request: request!.payload, node: node!.payload, item: item!.payload };
    const withdrawn = plan({ outcome: "cancelled", existing });
    if (!withdrawn.ok) throw new Error(withdrawn.cause);
    expect(
      withdrawn.events.map((event) => (event as { payload: { status: string } }).payload.status),
    ).toEqual(["cancelled", "cancelled", "cancelled"]);
    expect(
      plan({
        outcome: "cancelled",
        existing: {
          ...existing,
          request: { ...(existing.request as object), status: "resolved" } as never,
        },
      }),
    ).toEqual({ ok: true, events: [] });
  });
});

describe("answering it", () => {
  it.each([
    ["accept", false, false, undefined],
    ["decline", false, false, undefined],
    ["cancel", false, false, undefined],
  ] as const)("takes %s", (decision, hasFeedback, hasAnswers, expected) => {
    expect(kodoStartRequestDecisionRefusal({ decision, hasFeedback, hasAnswers })).toBe(expected);
  });

  it("refuses everything that would outlive the one request, or answer it as a question", () => {
    for (const decision of ["acceptForSession", "acceptAlways", undefined]) {
      expect(
        kodoStartRequestDecisionRefusal({ decision, hasFeedback: false, hasAnswers: false }),
      ).toBeDefined();
    }
    expect(
      kodoStartRequestDecisionRefusal({
        decision: "decline",
        hasFeedback: true,
        hasAnswers: false,
      }),
    ).toBeDefined();
    expect(
      kodoStartRequestDecisionRefusal({ decision: "accept", hasFeedback: false, hasAnswers: true }),
    ).toBeDefined();
  });

  it("is told apart from a provider's own approval by what raised it, not by what it says", () => {
    expect(isKodoStartRequest({ nativeRequestRef: null })).toBe(false);
    expect(
      isKodoStartRequest({
        nativeRequestRef: {
          driver: "claudeAgent",
          nativeId: "start-request",
          strength: "strong",
        } as never,
      }),
    ).toBe(false);
  });
});
