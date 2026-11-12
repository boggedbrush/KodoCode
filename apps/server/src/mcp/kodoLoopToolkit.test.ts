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

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import { testLoop } from "../kodo/loop/testing.ts";
import * as McpHttpServer from "./McpHttpServer.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import { idleThreadProjection, liveThreadShell } from "./McpToolAccess.testkit.ts";

const threadId = ThreadId.make("loop-tools-thread");

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

/** The tools called by a thread in `mode`, with the commands the orchestrator was sent. */
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
    const shell = liveThreadShell(threadId, { interactionMode: mode });
    const projection = {
      ...idleThreadProjection(shell),
    };
    const withLoop = {
      ...projection,
      thread: { ...projection.thread, kodoLoop: testLoop({ stage: "review", round: 2 }) },
    };
    const layer = McpHttpServer.layerKodoLoopToolkit.pipe(
      Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
      Layer.provide(NodeCrypto.layer),
      Layer.provide(ServerSettings.layerTest()),
      Layer.provide(
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(shell),
          getProjectThreadRecords: () => Effect.succeed(withLoop as never),
        }),
      ),
      Layer.provide(
        Layer.mock(Orchestrator.OrchestratorV2)({
          dispatch: ((command: OrchestrationV2Command) =>
            Ref.update(commands, (all) => [...all, command]).pipe(
              Effect.as({ sequence: 1, storedEvents: [] } as never),
            )) as never,
          getThreadRecords: () => Effect.succeed({ thread: withLoop.thread } as never),
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
        ["t3_loop_start", { request: "Add retries" }],
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

it.effect("a thread in Code mode starts and stops a loop through the loop service", () =>
  withTools("code", ({ call, commands }) =>
    Effect.gen(function* () {
      const started = yield* call("t3_loop_start", { request: "Add retries", rounds: 2 });
      expect(started.isError).toBe(false);
      const stopped = yield* call("t3_loop_stop", {});
      expect(stopped.isError).toBe(false);
      const sent = yield* Ref.get(commands);
      expect(sent.map((command) => command.type)).toEqual([
        "thread.kodo-loop.control",
        "thread.kodo-loop.control",
      ]);
      expect(sent[0]).toMatchObject({
        threadId,
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
