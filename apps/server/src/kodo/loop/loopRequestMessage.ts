// The person's `/loop ...` message as a row in the thread. A loop never runs it as a turn, but the
// person typed it, so it is recorded as an ordinary message (with no run) at the moment the loop
// starts, ahead of the first stage's own message. Every client then finds it by its id, which is what
// lets a client's pending copy settle, and it is still there after a reload.
import type {
  KodoLoopControl,
  NodeId,
  OrchestrationV2ConversationMessage,
  OrchestrationV2TurnItem,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import type * as DateTime from "effect/DateTime";

type StartControl = Extract<KodoLoopControl, { readonly type: "start" }>;

export function buildKodoLoopRequestMessage(input: {
  readonly threadId: ThreadId;
  readonly control: StartControl;
  readonly turnItemId: TurnItemId;
  readonly ordinal: number;
  readonly now: DateTime.Utc;
}): {
  readonly message: OrchestrationV2ConversationMessage;
  readonly turnItem: OrchestrationV2TurnItem;
} | null {
  const { control, now } = input;
  const sent = control.requestMessage;
  if (sent === undefined) return null;
  const provenance = {
    createdBy: sent.createdBy,
    creationSource: sent.creationSource,
    ...(sent.scheduledTaskId === undefined ? {} : { scheduledTaskId: sent.scheduledTaskId }),
    ...(sent.senderThreadId === undefined ? {} : { senderThreadId: sent.senderThreadId }),
  } as const;
  const message: OrchestrationV2ConversationMessage = {
    ...provenance,
    id: control.requestMessageId,
    threadId: input.threadId,
    runId: null,
    nodeId: null as NodeId | null,
    role: "user",
    text: sent.text,
    attachments: [],
    streaming: false,
    createdAt: now,
    updatedAt: now,
  };
  const turnItem: OrchestrationV2TurnItem = {
    ...provenance,
    id: input.turnItemId,
    threadId: input.threadId,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: input.ordinal,
    status: "completed",
    title: null,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    type: "user_message",
    messageId: control.requestMessageId,
    inputIntent: "turn_start",
    text: sent.text,
    attachments: [],
  };
  return { message, turnItem };
}
