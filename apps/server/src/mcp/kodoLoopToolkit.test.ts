// KODO: loop-mcp-tools - the agent tools over the loop service, through the production registration.
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2Command,
  type ThreadInteractionMode,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { McpSchema, McpServer } from "effect/ai";

import { decideKodoLoopControl } from "../kodo/loop/loopControl.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import { testLoop } from "../kodo/loop/testing.ts";
import * as McpHttpServer from "./McpHttpServer.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import { idleThreadProjection, liveThreadShell } from "./McpToolAccess.testkit.ts";

const threadId = ThreadId.make("loop-tools-thread");
const otherThreadId = ThreadId.make("loop-tools-other");
const busyThreadId = ThreadId.make("loop-tools-busy");

const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("loop-tools-environment"),
  requestNamespace: "loop-tools-session",
  thread: {
    threadId,
    providerSessionId: "loop-tools-session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "loop-tools", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "loop-tools", version: "1" },
  },
  getClient: Effect.die("unused"),
});

const declaredFailure = (result: McpSchema.CallToolResult) => {
  const text = result.content[0];
  return result.isError === true && text?.type === "text" ? JSON.parse(text.text) : undefined;
};

/**
 * The tools called by a thread in `mode`, with the commands the orchestrator was sent. The caller's
 * thread has its turn running (it is making the call); the other thread is idle. The orchestrator's
 * dispatch applies the loop's own start rule, busy check included, to the thread named.
 */
const withTools = <A, E>(
  mode: ThreadInteractionMode,
  body: (input: {
    readonly call: (
      name: string,
      args: Record<string, unknown>,
    ) => Effect.Effect<McpSchema.CallToolResult, never, never>;
    readonly commands: Ref.Ref<ReadonlyArray<OrchestrationV2Command>>;
  }) => Effect.Effect<A, E, McpServer.McpServer>,
) =>
  Effect.gen(function* () {
    const commands = yield* Ref.make<ReadonlyArray<OrchestrationV2Command>>([]);
    const shells = {
      [threadId]: liveThreadShell(threadId, { interactionMode: mode }),
      [otherThreadId]: liveThreadShell(otherThreadId, { interactionMode: mode, activeRunId: null }),
      [busyThreadId]: liveThreadShell(busyThreadId, { interactionMode: mode }),
    } as Record<string, ReturnType<typeof liveThreadShell>>;
    const projectionOf = (id: ThreadId) => {
      const projection = idleThreadProjection(shells[id]!);
      return {
        ...projection,
        thread: { ...projection.thread, kodoLoop: testLoop({ stage: "review", round: 2 }) },
      };
    };
    const runsOf = (id: ThreadId) =>
      id === threadId || id === busyThreadId
        ? [{ status: "running", ordinal: 1, checkpointId: null }]
        : [];
    const layer = McpHttpServer.layerKodoLoopToolkit.pipe(
      Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
      Layer.provide(NodeCrypto.layer),
      Layer.provide(ServerSettings.layerTest()),
      Layer.provide(
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: (id) => Effect.succeed(shells[id] ?? null),
          getProjectThreadRecords: (input) => Effect.succeed(projectionOf(input.threadId) as never),
        }),
      ),
      Layer.provide(
        Layer.mock(Orchestrator.OrchestratorV2)({
          dispatch: ((command: OrchestrationV2Command) =>
            Ref.update(commands, (all) => [...all, command]).pipe(
              Effect.andThen(
                command.type === "thread.kodo-loop.control" && command.control.type === "start"
                  ? // The loop's own rules decide, with the busy check unmocked.
                    (() => {
                      const decided = decideKodoLoopControl({
                        commandId: command.commandId,
                        control: command.control,
                        thread: {
                          interactionMode: "code",
                          kodoLoop: undefined,
                        },
                        runs: runsOf(command.threadId) as never,
                      });
                      return decided.ok
                        ? Effect.succeed({ sequence: 1, storedEvents: [] } as never)
                        : Effect.fail(
                            new Orchestrator.OrchestratorDispatchError({
                              commandId: command.commandId,
                              commandType: command.type,
                              cause: decided.message,
                            }),
                          );
                    })()
                  : Effect.succeed({ sequence: 1, storedEvents: [] } as never),
              ),
            )) as never,
          getThreadRecords: (id: ThreadId) =>
            Effect.succeed({ thread: projectionOf(id).thread } as never),
        }),
      ),
    );
    return yield* Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const call = (name: string, args: Record<string, unknown>) =>
        server
          .callTool({ name, arguments: args })
          .pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
            Effect.provideService(McpSchema.McpServerClient, client),
            Effect.orDie,
          );
      return yield* body({ call, commands });
    }).pipe(Effect.provide(layer));
  });

it.effect("a thread in a read-only mode cannot start or stop a loop, but can read one", () =>
  withTools("plan", ({ call, commands }) =>
    Effect.gen(function* () {
      for (const [name, args] of [
        ["t3_loop_start", { request: "Add retries", threadId: otherThreadId }],
        ["t3_loop_stop", {}],
      ] as const) {
        expect(declaredFailure(yield* call(name, args))).toMatchObject({
          code: "capability_denied",
        });
      }
      const status = yield* call("t3_loop_status", {});
      expect(status.isError).toBe(false);
      expect(status.structuredContent).toMatchObject({
        status: "active",
        round: 2,
        maxRounds: 3,
        stage: "review",
      });
      expect(yield* Ref.get(commands)).toEqual([]);
    }),
  ),
);

it.effect(
  "a thread in Code mode starts a loop on another idle thread and stops it through the loop service",
  () =>
    withTools("code", ({ call, commands }) =>
      Effect.gen(function* () {
        const started = yield* call("t3_loop_start", {
          request: "Add retries",
          rounds: 2,
          threadId: otherThreadId,
        });
        expect(started.isError).toBe(false);
        const stopped = yield* call("t3_loop_stop", { threadId: otherThreadId });
        expect(stopped.isError).toBe(false);
        const sent = yield* Ref.get(commands);
        expect(sent.map((command) => command.type)).toEqual([
          "thread.kodo-loop.control",
          "thread.kodo-loop.control",
        ]);
        expect(sent[0]).toMatchObject({
          threadId: otherThreadId,
          control: {
            type: "start",
            request: "Add retries",
            maxRounds: 2,
            requestMessage: { createdBy: "agent", creationSource: "mcp", senderThreadId: threadId },
          },
        });
        expect(sent[1]).toMatchObject({ control: { type: "stop" } });
      }),
    ),
);

it.effect(
  "starting without a thread, or on the caller's own, says why and to name another idle thread",
  () =>
    withTools("code", ({ call, commands }) =>
      Effect.gen(function* () {
        for (const args of [{ request: "Add retries" }, { request: "Add retries", threadId }]) {
          const failure = declaredFailure(yield* call("t3_loop_start", args));
          expect(failure).toMatchObject({ code: "invalid_request" });
          expect(failure.message).toContain("cannot loop while its own turn is running");
          expect(failure.message).toContain("Name another idle thread");
        }
        // Nothing reached the orchestrator, so its own "a turn is running" refusal was never needed.
        expect(yield* Ref.get(commands)).toEqual([]);
      }),
    ),
);

it.effect(
  "a thread that is busy is still refused by the loop's own rule, which no mock stands in for",
  () =>
    withTools("code", ({ call }) =>
      Effect.gen(function* () {
        const failure = declaredFailure(
          yield* call("t3_loop_start", { request: "Add retries", threadId: busyThreadId }),
        );
        expect(failure).toMatchObject({ code: "orchestration_error" });
        expect(failure.message).toContain("A turn is running on this thread");
      }),
    ),
);
