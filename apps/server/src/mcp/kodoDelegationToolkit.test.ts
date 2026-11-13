// KODO: delegation-mcp-tools - the agent tools over the sub-agents switch, through the production registration.
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

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as McpHttpServer from "./McpHttpServer.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import { liveThreadShell } from "./McpToolAccess.testkit.ts";

const callerId = ThreadId.make("sub-agents-caller");
const otherId = ThreadId.make("sub-agents-other");
const workerId = ThreadId.make("sub-agents-worker");

const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("sub-agents-environment"),
  requestNamespace: "sub-agents-session",
  thread: {
    threadId: callerId,
    providerSessionId: "sub-agents-session",
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
  clientInfo: { name: "sub-agents-tools", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "sub-agents-tools", version: "1" },
  },
  getClient: Effect.die("unused"),
});

const declaredFailure = (result: McpSchema.CallToolResult) => {
  const text = result.content[0];
  return result.isError === true && text?.type === "text" ? JSON.parse(text.text) : undefined;
};

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
      [callerId]: liveThreadShell(callerId, { interactionMode: mode }),
      // The target reads only when the caller does, so a read-only caller can name it.
      [otherId]: {
        ...liveThreadShell(otherId, { interactionMode: mode, activeRunId: null }),
        kodoLead: { kind: "sub-agents" as const },
      },
      [workerId]: {
        ...liveThreadShell(workerId, { interactionMode: mode, activeRunId: null }),
        status: "running" as const,
        lineage: {
          rootThreadId: otherId,
          parentThreadId: otherId,
          relationshipToParent: "subagent" as const,
        },
      },
    } as Record<string, ReturnType<typeof liveThreadShell>>;
    const layer = McpHttpServer.layerKodoDelegationToolkit.pipe(
      Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
      Layer.provide(NodeCrypto.layer),
      Layer.provide(ServerSettings.layerTest({ kodoSubAgentsMaxWorkers: 4 })),
      Layer.provide(
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: (id) => Effect.succeed(shells[id] ?? null),
          listAppOwnedChildThreadIds: (id) => Effect.succeed(id === otherId ? [workerId] : []),
          getProjectThreadRecords: (input) =>
            Effect.succeed({ thread: shells[input.threadId] } as never),
          dispatch: ((command: OrchestrationV2Command) =>
            Ref.update(commands, (all) => [...all, command]).pipe(
              Effect.as({ sequence: 1, storedEvents: [] } as never),
            )) as never,
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

it.effect("a read-only caller cannot change sub-agents, and can still read them", () =>
  withTools("plan", ({ call, commands }) =>
    Effect.gen(function* () {
      expect(
        declaredFailure(yield* call("t3_sub_agents_set", { threadId: otherId, enabled: false })),
      ).toMatchObject({ code: "capability_denied" });
      const status = yield* call("t3_sub_agents_status", { threadId: otherId });
      expect(status.isError).toBe(false);
      expect(status.structuredContent).toMatchObject({ enabled: true, maxWorkers: 4, running: 1 });
      expect(yield* Ref.get(commands)).toEqual([]);
    }),
  ),
);

it.effect("an agent cannot change its own thread, whatever it asks for", () =>
  withTools("code", ({ call, commands }) =>
    Effect.gen(function* () {
      for (const enabled of [true, false]) {
        const failure = declaredFailure(
          yield* call("t3_sub_agents_set", { threadId: callerId, enabled }),
        );
        expect(failure).toMatchObject({ code: "capability_denied" });
        expect(failure.message).toContain("own thread");
      }
      expect(yield* Ref.get(commands)).toEqual([]);
    }),
  ),
);

it.effect("a Code caller changes another thread through the command, stamped with who it is", () =>
  withTools("code", ({ call, commands }) =>
    Effect.gen(function* () {
      const result = yield* call("t3_sub_agents_set", { threadId: otherId, enabled: false });
      expect(result.isError).toBe(false);
      const sent = yield* Ref.get(commands);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        type: "thread.kodo-lead.set",
        threadId: otherId,
        lead: null,
        createdBy: "agent",
        creationSource: "mcp",
        senderThreadId: callerId,
      });
    }),
  ),
);

it.effect("reports the workers of a lead with their mode, status and model", () =>
  withTools("code", ({ call }) =>
    Effect.gen(function* () {
      const status = yield* call("t3_sub_agents_status", { threadId: otherId });
      expect(status.structuredContent).toMatchObject({
        enabled: true,
        workers: [{ threadId: workerId, mode: "code", status: "running", model: "gpt-5" }],
      });
      const own = yield* call("t3_sub_agents_status", {});
      expect(own.structuredContent).toMatchObject({ enabled: false, workers: [] });
    }),
  ),
);
