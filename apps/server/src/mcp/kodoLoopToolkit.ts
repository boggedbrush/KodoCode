// Kodo: agent access to the loop. Three thin tools over the loop service the `/loop` command uses, so
// an agent and a person start, stop and read a loop through the same rules: the sender's mode limit
// (a sender below Code cannot start one, since its coding stage writes files) is enforced by the
// orchestrator, and start and stop are refused outright for a caller in a read-only mode.
import {
  KODO_LOOP_MAX_ROUNDS,
  KODO_LOOP_REQUEST_MAX_CHARS,
  KodoLoopStage,
  KodoLoopStatus,
  KodoLoopStopReason,
  MessageId,
  OrchestratorMcpFailure,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import { kodoInteractionModeRank } from "../kodo/interactionMode.ts";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

import { makeKodoLoopService, type KodoLoopService } from "../kodo/loop/LoopService.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as McpToolAccess from "./McpToolAccess.ts";
import { dispatchFailure, newCommandId, readCaller, readThread } from "./threadAccess.ts";

/** The loop service `/loop` uses, built over the same orchestrator and settings. */
export class KodoLoopTools extends Context.Service<KodoLoopTools, KodoLoopService>()(
  "t3/mcp/kodoLoopToolkit/KodoLoopTools",
) {}

export const layerService = Layer.effect(
  KodoLoopTools,
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    return makeKodoLoopService({ orchestrator, serverSettings });
  }),
);

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  SecureRandom.SecureRandom,
  KodoLoopTools,
];

const LoopResult = Schema.Struct({
  note: Schema.String,
  status: Schema.optional(KodoLoopStatus),
  round: Schema.optional(Schema.Number),
  maxRounds: Schema.optional(Schema.Number),
  stage: Schema.optional(KodoLoopStage),
  stopReason: Schema.optional(KodoLoopStopReason),
});

const LoopStartTool = Tool.make("t3_loop_start", {
  description:
    "Start a loop in another idle thread: plan, code, review and judge in rounds until the judge finds `request` complete or `rounds` run out. Use only when the user explicitly asks for a loop. It edits files, so it needs Code mode. Name the idle thread in `threadId`; this thread cannot loop while its own turn runs. One loop per thread; it ends when a message is sent there. A loop's own stages cannot start loops, and an agent cannot restart a loop the budget or a person stopped. Poll with `t3_loop_status`.",
  parameters: Schema.Struct({
    threadId: Schema.optional(ThreadId),
    request: Schema.String.check(
      Schema.isNonEmpty(),
      Schema.isMaxLength(KODO_LOOP_REQUEST_MAX_CHARS),
    ),
    rounds: Schema.optional(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: KODO_LOOP_MAX_ROUNDS })),
    ),
  }),
  success: LoopResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Start a loop")
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

const LoopStopTool = Tool.make("t3_loop_stop", {
  description:
    "Stop the loop running in a thread. Interrupts the stage in flight. Omit `threadId` for this thread.",
  parameters: Schema.Struct({ threadId: Schema.optional(ThreadId) }),
  success: LoopResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Stop a loop")
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true);

const LoopStatusTool = Tool.make("t3_loop_status", {
  description:
    "Read a thread's loop: `status`, `round` of `maxRounds`, `stage`, and `stopReason` once it ended. Omit `threadId` for this thread.",
  parameters: Schema.Struct({ threadId: Schema.optional(ThreadId) }),
  success: LoopResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Get loop status")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const KodoLoopToolkit = Toolkit.make(LoopStartTool, LoopStopTool, LoopStatusTool);

/** Start and stop change a thread; a caller in Ask, Plan or Review cannot. Status is a read. */
const refuseReadOnlyCaller = (tool: string) =>
  Effect.flatMap(readCaller(), (caller) =>
    kodoInteractionModeRank(caller.limits.interactionMode) === 0
      ? Effect.fail(
          new OrchestratorMcpFailure({
            code: "capability_denied",
            message:
              caller.caller?.kodoLead == null
                ? `${tool} changes things, and this thread is in a read-only mode (Ask, Plan or Review). Switch the thread to Code mode to use it.`
                : `${tool} changes things, and this thread only delegates. Hand the work to a worker with delegate_task; a person can start a loop with /loop.`,
          }),
        )
      : Effect.void,
  );

const standing = (loop: {
  readonly status: Schema.Schema.Type<typeof KodoLoopStatus>;
  readonly round: number;
  readonly maxRounds: number;
  readonly stage: Schema.Schema.Type<typeof KodoLoopStage>;
  readonly stopReason?: Schema.Schema.Type<typeof KodoLoopStopReason> | undefined;
}) => ({
  status: loop.status,
  round: loop.round,
  maxRounds: loop.maxRounds,
  stage: loop.stage,
  ...(loop.stopReason === undefined ? {} : { stopReason: loop.stopReason }),
});

const handlers = {
  t3_loop_start: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        yield* refuseReadOnlyCaller("t3_loop_start");
        const { projection, caller } = yield* readThread(input.threadId);
        // The caller's own turn is running while it calls this, so its own thread can never loop.
        if (caller !== undefined && projection.thread.id === caller.id) {
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message:
              "A thread cannot loop while its own turn is running, and this call is that turn. Name another idle thread in `threadId`.",
          });
        }
        const loops = yield* KodoLoopTools;
        const commandId = yield* newCommandId();
        yield* loops
          .start({
            threadId: projection.thread.id,
            commandId,
            requestMessageId: MessageId.make(`message:${commandId}`),
            request: input.request,
            ...(input.rounds === undefined ? {} : { maxRounds: input.rounds }),
            requestMessage: {
              text: `/loop ${input.request}`.slice(0, KODO_LOOP_REQUEST_MAX_CHARS + 200),
              createdBy: "agent",
              creationSource: "mcp",
              ...(caller === undefined ? {} : { senderThreadId: caller.id }),
            },
          })
          .pipe(Effect.mapError(dispatchFailure));
        return {
          note: "The loop started. It runs in the background; read it with t3_loop_status.",
          status: "active" as const,
        };
      }),
  ),
  t3_loop_stop: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        yield* refuseReadOnlyCaller("t3_loop_stop");
        const { projection } = yield* readThread(input.threadId);
        const loops = yield* KodoLoopTools;
        const commandId = yield* newCommandId();
        yield* loops
          .stop({ threadId: projection.thread.id, commandId })
          .pipe(Effect.mapError(dispatchFailure));
        return { note: "The loop was stopped.", status: "stopped" as const };
      }),
  ),
  t3_loop_status: McpToolAccess.reads((input: { readonly threadId?: ThreadId | undefined }) =>
    Effect.gen(function* () {
      const { projection } = yield* readThread(input.threadId);
      const loops = yield* KodoLoopTools;
      const note = yield* loops.status(projection.thread.id).pipe(Effect.mapError(dispatchFailure));
      const loop = projection.thread.kodoLoop;
      return { note, ...(loop === undefined ? {} : standing(loop)) };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof KodoLoopToolkit.tools>;

export const layer = McpToolAccess.toLayer(KodoLoopToolkit, handlers);
