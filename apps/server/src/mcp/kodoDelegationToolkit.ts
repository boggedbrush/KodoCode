// Kodo: agent access to sub-agents. `t3_sub_agents_set` is a thin tool over the same command the
// composer switch sends (`thread.kodo-lead.set`), so an agent and a person are judged by the same
// rules: the orchestrator refuses a running thread, a loop, an unsupported provider, and an agent
// turning it on for its own thread or for the lead it works for. The tool also refuses a read-only
// caller before anything is sent. `t3_sub_agents_status` is a read.
import { CommandId, OrchestratorMcpFailure, ThreadId } from "@t3tools/contracts";
import { kodoThreadOwnModel } from "@t3tools/shared/kodoModeModel";
import * as Effect from "effect/Effect";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import { isKodoLead } from "../kodo/delegation/leadGuard.ts";
import { kodoInteractionModeRank } from "../kodo/interactionMode.ts";
import { kodoMaxWorkers } from "../kodo/delegation/limits.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as McpToolAccess from "./McpToolAccess.ts";
import {
  dispatchFailure,
  newCommandId,
  readCaller,
  readThread,
  unavailable,
} from "./threadAccess.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  SecureRandom.SecureRandom,
  ServerSettings.ServerSettingsService,
];

/** The newest workers a status lists. */
const MAX_LISTED_WORKERS = 20;

const SubAgentsStatus = Schema.Struct({
  enabled: Schema.Boolean,
  note: Schema.String,
  maxWorkers: Schema.Number,
  running: Schema.Number,
  workers: Schema.Array(
    Schema.Struct({
      threadId: ThreadId,
      title: Schema.String,
      mode: Schema.String,
      status: Schema.String,
      model: Schema.String,
    }),
  ),
});

const SubAgentsSetTool = Tool.make("t3_sub_agents_set", {
  description:
    "Turn sub-agents on or off for another idle thread: its turns then delegate to workers instead of doing the work. Not for your own thread or the lead you work for, and not while a turn or loop runs there.",
  parameters: Schema.Struct({ threadId: ThreadId, enabled: Schema.Boolean }),
  success: SubAgentsStatus,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Set sub-agents")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const SubAgentsStatusTool = Tool.make("t3_sub_agents_status", {
  description:
    "Read a thread's sub-agents: whether it leads, the live-worker limit, and its newest workers (mode, status, model). Omit `threadId` for this thread.",
  parameters: Schema.Struct({ threadId: Schema.optional(ThreadId) }),
  success: SubAgentsStatus,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Get sub-agents status")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const KodoDelegationToolkit = Toolkit.make(SubAgentsSetTool, SubAgentsStatusTool);

const readStatus = Effect.fn("mcp.kodoSubAgentsStatus")(function* (threadId: ThreadId | undefined) {
  const { threads, projection } = yield* readThread(threadId);
  const settings = yield* (yield* ServerSettings.ServerSettingsService).getSettings.pipe(
    Effect.mapError(unavailable),
  );
  const id = projection.thread.id;
  const childIds = (yield* threads
    .listAppOwnedChildThreadIds(id)
    .pipe(Effect.mapError(unavailable)))
    .slice(-MAX_LISTED_WORKERS)
    .toReversed();
  const workers = [];
  for (const childId of childIds) {
    const shell = yield* threads.getThreadShell(childId).pipe(Effect.mapError(unavailable));
    if (shell === null || shell.deletedAt !== null) continue;
    workers.push({
      threadId: shell.id,
      title: shell.title,
      mode: shell.interactionMode,
      status: shell.status,
      model: kodoThreadOwnModel(shell).model,
    });
  }
  const enabled = isKodoLead(projection.thread);
  return {
    enabled,
    note: enabled ? "This thread leads sub-agents." : "Sub-agents are off for this thread.",
    maxWorkers: kodoMaxWorkers(settings.kodoSubAgentsMaxWorkers),
    running: workers.filter(
      (worker) =>
        !["idle", "completed", "failed", "cancelled", "interrupted"].includes(worker.status),
    ).length,
    workers,
  };
});

/** Changing sub-agents changes what a thread spends and starts; a caller in Ask, Plan or Review cannot. */
const refuseReadOnlyCaller = Effect.flatMap(readCaller(), (caller) =>
  kodoInteractionModeRank(caller.limits.interactionMode) === 0
    ? Effect.fail(
        new OrchestratorMcpFailure({
          code: "capability_denied",
          message:
            "t3_sub_agents_set changes things, and this thread is in a read-only mode (Ask, Plan or Review). Switch the thread to Code mode to use it.",
        }),
      )
    : Effect.void,
);

const handlers = {
  t3_sub_agents_set: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        yield* refuseReadOnlyCaller;
        const { caller, threads } = yield* readCaller();
        if (caller !== undefined && caller.id === input.threadId) {
          return yield* new OrchestratorMcpFailure({
            code: "capability_denied",
            message:
              "An agent cannot turn sub-agents on or off for its own thread. Ask the person to use the Sub-agents switch.",
          });
        }
        const commandId = yield* newCommandId();
        yield* threads
          .dispatch({
            type: "thread.kodo-lead.set",
            commandId: CommandId.make(commandId),
            threadId: input.threadId,
            lead: input.enabled ? { kind: "sub-agents" } : null,
            createdBy: "agent",
            creationSource: "mcp",
            ...(caller === undefined ? {} : { senderThreadId: caller.id }),
          })
          .pipe(Effect.mapError(dispatchFailure));
        return yield* readStatus(input.threadId);
      }),
  ),
  t3_sub_agents_status: McpToolAccess.reads((input: { readonly threadId?: ThreadId | undefined }) =>
    readStatus(input.threadId),
  ),
} satisfies McpToolAccess.Handlers<typeof KodoDelegationToolkit.tools>;

export const layer = McpToolAccess.toLayer(KodoDelegationToolkit, handlers);
