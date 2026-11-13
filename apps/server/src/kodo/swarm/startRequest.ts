// The Orchestrator's start confirmation, as the orchestrator records it: an approval on its own run,
// answered only by a person's `runtime-request.respond`, decided here from the stored request alone.
// Pure: the orchestrator hooks read the projection, call these, and emit what they return.
import {
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ExecutionNode,
  type OrchestrationV2ProviderRef,
  type OrchestrationV2Run,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2TurnItem,
  type ProviderSessionId,
  type ProviderTurnId,
  type RuntimeRequestId,
  NodeId,
  ProviderDriverKind,
  type TurnItemId,
} from "@t3tools/contracts";
import type * as DateTime from "effect/DateTime";

type DistributiveOmit<Type, Key extends PropertyKey> = Type extends unknown
  ? Omit<Type, Key>
  : never;
export type KodoStartRequestEvent = DistributiveOmit<OrchestrationV2DomainEvent, "id">;

/** What marks a runtime request as the Orchestrator's start confirmation, not a provider's approval. */
const START_REQUEST_REF: OrchestrationV2ProviderRef = {
  driver: ProviderDriverKind.make("kodo"),
  nativeId: "start-request",
  strength: "strong",
};

export const isKodoStartRequest = (
  request: Pick<OrchestrationV2RuntimeRequest, "nativeRequestRef">,
): boolean =>
  request.nativeRequestRef?.driver === START_REQUEST_REF.driver &&
  request.nativeRequestRef.nativeId === START_REQUEST_REF.nativeId;

export const kodoStartRequestNodeId = (requestId: RuntimeRequestId): NodeId =>
  NodeId.make(`${requestId}:node`);

/** Approve or decline are the only answers; "for this session" and "always" would outlive the one request. */
export function kodoStartRequestDecisionRefusal(input: {
  readonly decision: string | undefined;
  readonly hasFeedback: boolean;
  readonly hasAnswers: boolean;
}): string | undefined {
  if (input.hasFeedback || input.hasAnswers) return "Approve or decline this request.";
  return input.decision === "accept" || input.decision === "decline" || input.decision === "cancel"
    ? undefined
    : "Approve or decline this request.";
}

export interface KodoStartRequestRecordInput {
  readonly requestId: RuntimeRequestId;
  readonly outcome: "pending" | "cancelled";
  readonly prompt: string;
  readonly reason: string;
  readonly threadId: OrchestrationV2Run["threadId"];
  readonly run: Pick<
    OrchestrationV2Run,
    "id" | "rootNodeId" | "providerThreadId" | "providerInstanceId"
  >;
  /** The run is live and not being stopped. */
  readonly runActive: boolean;
  readonly commandNodeId: NodeId;
  readonly providerTurnId: ProviderTurnId | null;
  readonly providerSessionId: ProviderSessionId | null;
  readonly turnItemId: TurnItemId;
  readonly ordinal: number;
  readonly existing:
    | {
        readonly request: OrchestrationV2RuntimeRequest;
        readonly node: OrchestrationV2ExecutionNode | undefined;
        readonly item: OrchestrationV2TurnItem | undefined;
      }
    | undefined;
  readonly now: DateTime.Utc;
}

export type KodoStartRequestPlan =
  | { readonly ok: true; readonly events: ReadonlyArray<KodoStartRequestEvent> }
  | { readonly ok: false; readonly cause: string };

/** Raises the confirmation, or closes a pending one as cancelled; a request already answered is left as it is. */
export function planKodoStartRequestRecord(
  input: KodoStartRequestRecordInput,
): KodoStartRequestPlan {
  const { run, existing, now } = input;
  if (run.rootNodeId !== input.commandNodeId) {
    return {
      ok: false,
      cause: `Node ${input.commandNodeId} is not the root of run ${run.id}.`,
    };
  }
  const nodeId = kodoStartRequestNodeId(input.requestId);
  const base = { threadId: input.threadId, runId: run.id, nodeId, occurredAt: now } as const;
  if (input.outcome === "cancelled") {
    if (existing === undefined || existing.request.status !== "pending") {
      return { ok: true, events: [] };
    }
    const events: Array<KodoStartRequestEvent> = [
      {
        ...base,
        type: "runtime-request.updated",
        payload: {
          ...existing.request,
          status: "cancelled",
          responseCapability: { type: "not_resumable", reason: "The request was withdrawn." },
          resolvedAt: now,
        },
      },
    ];
    if (existing.node !== undefined) {
      events.push({
        ...base,
        type: "node.updated",
        payload: { ...existing.node, status: "cancelled", completedAt: now },
      });
    }
    if (existing.item !== undefined) {
      events.push({
        ...base,
        type: "turn-item.updated",
        payload: { ...existing.item, status: "cancelled", completedAt: now, updatedAt: now },
      });
    }
    return { ok: true, events };
  }
  if (existing !== undefined) return { ok: true, events: [] };
  if (!input.runActive) return { ok: false, cause: `Run ${run.id} is not active.` };
  if (input.providerSessionId === null) {
    return { ok: false, cause: "The Orchestrator has no live provider session to ask from." };
  }
  const request: OrchestrationV2RuntimeRequest = {
    id: input.requestId,
    nodeId,
    providerTurnId: input.providerTurnId,
    nativeRequestRef: START_REQUEST_REF,
    kind: "permission",
    status: "pending",
    // Live on the Orchestrator's own session, so the session ending closes it like any other approval.
    responseCapability: { type: "live", providerSessionId: input.providerSessionId },
    createdAt: now,
    resolvedAt: null,
  };
  const node: OrchestrationV2ExecutionNode = {
    id: nodeId,
    threadId: input.threadId,
    runId: run.id,
    parentNodeId: input.commandNodeId,
    rootNodeId: input.commandNodeId,
    kind: "approval_request",
    status: "waiting",
    countsForRun: false,
    providerThreadId: run.providerThreadId,
    providerTurnId: input.providerTurnId,
    nativeItemRef: START_REQUEST_REF,
    runtimeRequestId: input.requestId,
    checkpointScopeId: null,
    startedAt: now,
    completedAt: null,
  };
  const item: OrchestrationV2TurnItem = {
    id: input.turnItemId,
    threadId: input.threadId,
    runId: run.id,
    nodeId,
    providerThreadId: run.providerThreadId,
    providerTurnId: input.providerTurnId,
    nativeItemRef: START_REQUEST_REF,
    parentItemId: null,
    ordinal: input.ordinal,
    status: "waiting",
    title: null,
    startedAt: now,
    completedAt: null,
    updatedAt: now,
    type: "approval_request",
    requestId: input.requestId,
    requestKind: "permission",
    prompt: input.prompt,
    reason: input.reason,
    appName: "Start work",
    options: [
      { decision: "decline", label: "Decline" },
      { decision: "accept", label: "Approve" },
    ],
  };
  return {
    ok: true,
    events: [
      { ...base, type: "runtime-request.updated", payload: request },
      { ...base, type: "node.updated", providerInstanceId: run.providerInstanceId, payload: node },
      {
        ...base,
        type: "turn-item.updated",
        providerInstanceId: run.providerInstanceId,
        payload: item,
      },
    ],
  };
}
