// KODO: swarm-guard - the Orchestrator's tool allowlist, at the tool door.
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  OrchestratorMcpFailure,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import { KODO_ORCHESTRATOR_TOOLS } from "../kodo/swarm/swarmAllowlist.ts";
import { KodoDelegationToolkit } from "./kodoDelegationToolkit.ts";
import { KodoLoopToolkit } from "./kodoLoopToolkit.ts";
import { AttachmentToolkit } from "./toolkits/attachment/tools.ts";
import { EnvironmentToolkit } from "./toolkits/environment/tools.ts";
import { OrchestratorToolkit } from "./toolkits/orchestrator/tools.ts";
import { ProjectToolkit } from "./toolkits/project/tools.ts";
import { ThreadToolkit } from "./toolkits/thread/tools.ts";
import { type McpInvocationScope, McpInvocationContext } from "./McpInvocationContext.ts";
import { guardSwarmTools } from "./kodoSwarmGuard.ts";

const make = (name: string) =>
  Tool.make(name, {
    parameters: Schema.Struct({}),
    success: Schema.Struct({ ran: Schema.String }),
    failure: OrchestratorMcpFailure,
    failureMode: "return" as const,
  });

// Names an upstream tool might gain later are denied until they are listed.
const NAMES = [
  ...KODO_ORCHESTRATOR_TOOLS,
  "t3_project_update",
  "t3_project_delete",
  "t3_thread_launch",
  "t3_thread_send",
  "create_threads",
  "t3_loop_start",
  "t3_sub_agents_set",
  "schedule_task",
  "request_secret",
  "a_tool_added_later",
];
const toolkit = Toolkit.make(...NAMES.map(make));
const handlers = Object.fromEntries(
  NAMES.map((name) => [name, () => Effect.succeed({ ran: name })] as const),
);
const guarded = guardSwarmTools(toolkit, handlers) as Record<
  string,
  () => Effect.Effect<unknown, OrchestratorMcpFailure, McpInvocationContext>
>;

const scope = (kodoSwarm: boolean): McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment"),
  requestNamespace: "provider:thread",
  thread: {
    threadId: ThreadId.make("thread"),
    providerSessionId: "provider:thread",
    providerInstanceId: ProviderInstanceId.make("codex"),
    ...(kodoSwarm ? { kodoSwarm: true } : {}),
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
});

const call = (name: string, swarm: boolean) =>
  guarded[name]!().pipe(
    Effect.provideService(McpInvocationContext, scope(swarm)),
    Effect.map(() => "ran" as const),
    Effect.catch((error) => Effect.succeed(error.code)),
  );

it.effect.each([...NAMES])("%s for the Orchestrator", (name) =>
  Effect.gen(function* () {
    expect(yield* call(name, true)).toBe(
      KODO_ORCHESTRATOR_TOOLS.has(name) ? "ran" : "capability_denied",
    );
  }),
);

it.effect.each([...NAMES])("%s for any other thread is untouched", (name) =>
  Effect.gen(function* () {
    expect(yield* call(name, false)).toBe("ran");
  }),
);

it("lists only reads of projects and threads, and the tools that start and stop its own work", () => {
  expect([...KODO_ORCHESTRATOR_TOOLS].toSorted()).toEqual([
    "delegate_task",
    "t3_project_list",
    "t3_project_read",
    "t3_thread_list",
    "t3_thread_read",
    "t3_thread_search",
    "task_cancel",
    "task_status",
  ]);
});

// A tool the guard cannot refuse (its failure type cannot carry the refusal) would escape the
// allowlist, so every tool the Orchestrator's credential can reach must be one the guard covers.
it("covers every real tool its credential can reach, and lists only tools that exist", () => {
  const reachable = [
    OrchestratorToolkit,
    ProjectToolkit,
    ThreadToolkit,
    EnvironmentToolkit,
    AttachmentToolkit,
    KodoDelegationToolkit,
    KodoLoopToolkit,
  ].flatMap((kit) => Object.values(kit.tools));
  const names = new Set(reachable.map((tool) => tool.name));
  for (const tool of reachable) {
    expect(tool.failureSchema === OrchestratorMcpFailure, `${tool.name} cannot be refused`).toBe(
      true,
    );
  }
  for (const listed of KODO_ORCHESTRATOR_TOOLS) expect(names.has(listed), listed).toBe(true);
});
