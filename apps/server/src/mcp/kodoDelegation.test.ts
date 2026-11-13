// KODO: delegation-normalize - what a lead's delegation calls become, through the real service.
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  EnvironmentId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as RemoteDelegation from "../peer/RemoteDelegation.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ServerSettings from "../serverSettings.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import * as OrchestratorMcpService from "./OrchestratorMcpService.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

const projectId = ProjectId.make("project:lead");
const leadId = ThreadId.make("thread:lead");
const runId = RunId.make("run:lead");
const rootNodeId = NodeId.make("node:lead-root");
const own = ProviderInstanceId.make("claude-own");
const slotInstance = ProviderInstanceId.make("codex-slot");

const provider = (instanceId: ProviderInstanceId, driver: string, model: string): ServerProvider =>
  ({
    instanceId,
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: "test",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-13T00:00:00.000Z",
    models: [{ slug: model, name: model, isCustom: false, capabilities: null }],
    slashCommands: [],
    skills: [],
  }) as ServerProvider;

const scope = (threadId: ThreadId): McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment:lead"),
  requestNamespace: `provider-session:${threadId}`,
  thread: {
    threadId,
    providerSessionId: `provider-session:${threadId}`,
    providerInstanceId: own,
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
});

interface World {
  readonly mode: "code" | "plan" | "ask" | "review";
  /** The model the lead thread shows: the Orchestrator model standing in for its own. */
  readonly leadSelection: { instanceId: ProviderInstanceId; model: string };
  readonly leadOwn?: { instanceId: ProviderInstanceId; model: string };
  readonly lead?: boolean;
  /** Extra threads by id, for the guard's reads. */
  readonly shells?: Record<string, Record<string, unknown>>;
  readonly children?: ReadonlyArray<string>;
  readonly settings?: Parameters<typeof ServerSettings.layerTest>[0];
  readonly usageLimits?: ServerProvider["usageLimits"];
  readonly callerId?: ThreadId;
}

const shell = (id: ThreadId, fields: Record<string, unknown> = {}) => ({
  id,
  projectId,
  title: id,
  providerInstanceId: own,
  modelSelection: { instanceId: own, model: "claude-own-model" },
  runtimeMode: "full-access",
  interactionMode: "code",
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
  status: "idle",
  activityRunStatus: null,
  pendingRuntimeRequest: null,
  pendingBackgroundTasks: [],
  createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
  deletedAt: null,
  ...fields,
});

const run = <A, E>(
  world: World,
  body: (input: {
    readonly service: OrchestratorMcpService.OrchestratorMcpService["Service"];
    readonly dispatched: Ref.Ref<ReadonlyArray<Record<string, unknown>>>;
  }) => Effect.Effect<A, E, never>,
) =>
  Effect.gen(function* () {
    const dispatched = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([]);
    const caller = world.callerId ?? leadId;
    const leadShell = shell(leadId, {
      interactionMode: world.mode,
      modelSelection: world.leadSelection,
      ...(world.lead === false ? {} : { kodoLead: { kind: "sub-agents" } }),
      ...(world.leadOwn === undefined
        ? {}
        : { kodoModeModel: { applied: world.leadSelection, base: world.leadOwn } }),
    });
    const shells: Record<string, unknown> = { [leadId]: leadShell, ...world.shells };
    const parentProjection = {
      thread: leadShell,
      runs: [
        {
          id: runId,
          ordinal: 1,
          status: "running",
          rootNodeId,
          providerInstanceId: own,
          modelSelection: world.leadSelection,
          requestedAt: DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
        },
      ],
      contextTransfers: [],
      subagents: [],
    } as unknown as OrchestrationV2ThreadProjection;
    const task = {
      id: NodeId.make("node:task"),
      threadId: leadId,
      origin: "app_owned",
      childThreadId: ThreadId.make("thread:worker"),
      status: "running",
      result: null,
    };
    const providers = [
      provider(own, "claudeAgent", "claude-own-model"),
      provider(slotInstance, "codex", "slot-model"),
    ].map((entry) =>
      world.usageLimits === undefined ? entry : { ...entry, usageLimits: world.usageLimits },
    );
    const dependencies = Layer.mergeAll(
      NodeServices.layer,
      NodeCrypto.layer,
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        hasReceipt: () => Effect.succeed(false),
        assertProviderInstanceEnabled: () => Effect.void,
        isProviderInstanceEnabledForProject: () => Effect.succeed(true),
        getThreadShell: (id) => Effect.succeed((shells[id] ?? null) as never),
        listAppOwnedChildThreadIds: () =>
          Effect.succeed((world.children ?? []).map((child) => ThreadId.make(child))),
        getThreadRecords: (id) =>
          Effect.succeed(
            (id === leadId
              ? parentProjection
              : ({
                  thread: shells[id],
                  runs: [],
                  messages: [],
                  subagents: [],
                  contextTransfers: [],
                } as never)) as never,
          ),
        dispatch: (command) =>
          Ref.update(dispatched, (all) => [...all, command as never]).pipe(
            Effect.as({
              sequence: 1,
              storedEvents: [
                {
                  sequence: 1,
                  commandId: null,
                  event: { type: "subagent.updated", payload: task },
                },
              ],
            } as never),
          ),
      }),
      ServerSettings.layerTest(world.settings ?? {}),
      Layer.mock(ProviderRegistry.ProviderRegistry)({
        getProviders: Effect.succeed(providers),
        refreshInstance: () => Effect.succeed(providers),
      }),
      Layer.succeed(
        ProviderAdapterRegistry.ProviderAdapterRegistryV2,
        ProviderAdapterRegistry.ProviderAdapterRegistryV2.of({
          list: () => Effect.succeed([own, slotInstance]),
          get: (instanceId) =>
            Effect.succeed({
              instanceId,
            } as unknown as ProviderAdapter.ProviderAdapterV2["Service"]),
        }),
      ),
      Layer.mock(ProjectService.ProjectService)({}),
      Layer.mock(SecretRequests.SecretRequests)({}),
      Layer.mock(RemoteDelegation.RemoteDelegation)({}),
      Layer.mock(ScheduledTaskService.ScheduledTaskService)({}),
    );
    const layer = OrchestratorMcpService.layer.pipe(
      Layer.provide(Layer.mock(ThreadLaunchService.ThreadLaunchService)({})),
      Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
      Layer.provide(dependencies),
    );
    return yield* Effect.gen(function* () {
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* body({ service, dispatched });
    }).pipe(
      Effect.provide(layer),
      Effect.map((value) => ({ value, caller })),
    );
  }).pipe(Effect.map(({ value }) => value));

/** The delegation as the lead made it. Reading the task back is not modelled, so that one failure is ignored. */
const delegate = (
  service: OrchestratorMcpService.OrchestratorMcpService["Service"],
  input: Parameters<OrchestratorMcpService.OrchestratorMcpService["Service"]["delegateTask"]>[1],
  caller: ThreadId = leadId,
) =>
  service.delegateTask(scope(caller), input).pipe(
    Effect.catchIf(
      (error) => error.code === "task_not_found",
      () => Effect.void,
    ),
  );

const lastCommand = (all: ReadonlyArray<Record<string, unknown>>) =>
  all.at(-1) as Record<string, any>;

describe("a lead's delegate_task", () => {
  it.effect(
    "runs the worker on its mode's slot: no explicit pick, and the lead's own model is what it inherits",
    () =>
      run(
        {
          mode: "code",
          leadSelection: { instanceId: slotInstance, model: "slot-model" },
          leadOwn: { instanceId: own, model: "claude-own-model" },
        },
        ({ service, dispatched }) =>
          Effect.gen(function* () {
            yield* delegate(service, {
              task: "Add retries.",
              role: "implementation",
              mode: "async",
              clientRequestId: "lead-implementation",
            });
            const command = lastCommand(yield* Ref.get(dispatched));
            assert.equal(command.type, "delegated_task.request");
            assert.equal(command.interactionMode, "code");
            // Nothing the lead said names a model, so nothing is recorded as an explicit pick.
            assert.equal(command.explicitModelSelection, false);
            // The worker inherits the lead's own model, not the Orchestrator model standing in for it.
            assert.deepEqual(command.modelSelection, {
              instanceId: own,
              model: "claude-own-model",
            });
          }),
      ),
  );

  it.effect("ignores a model, provider, driver or effort the lead names", () =>
    run(
      { mode: "code", leadSelection: { instanceId: own, model: "claude-own-model" } },
      ({ service, dispatched }) =>
        Effect.gen(function* () {
          yield* delegate(service, {
            task: "Add retries.",
            role: "implementation",
            mode: "async",
            clientRequestId: "lead-names-model",
            target: {
              providerInstanceId: slotInstance,
              model: "slot-model",
              driverKind: ProviderDriverKind.make("codex"),
              options: [{ id: "effort", value: "max" }],
            },
          });
          const command = lastCommand(yield* Ref.get(dispatched));
          assert.equal(command.explicitModelSelection, false);
          assert.equal(command.modelSelection.instanceId, own);
          assert.equal(command.modelSelection.model, "claude-own-model");
        }),
    ),
  );

  it.effect("gives a review worker a Review-mode child, and a research role an Ask one", () =>
    run(
      { mode: "code", leadSelection: { instanceId: own, model: "claude-own-model" } },
      ({ service, dispatched }) =>
        Effect.gen(function* () {
          for (const [role, mode] of [
            ["review", "review"],
            ["research", "ask"],
            ["test", "code"],
          ] as const) {
            yield* delegate(service, {
              task: "Go.",
              role,
              mode: "async",
              clientRequestId: `role-${role}`,
            });
            assert.equal(lastCommand(yield* Ref.get(dispatched)).interactionMode, mode, role);
          }
        }),
    ),
  );

  it.effect.each(["ask", "plan", "review"] as const)(
    "never hands a %s lead a Code worker, by role or by an explicit mode",
    (mode) =>
      run(
        { mode, leadSelection: { instanceId: own, model: "claude-own-model" } },
        ({ service, dispatched }) =>
          Effect.gen(function* () {
            yield* delegate(service, {
              task: "Implement it.",
              role: "implementation",
              mode: "async",
              clientRequestId: `role-${mode}`,
            });
            const byRole = lastCommand(yield* Ref.get(dispatched)).interactionMode;
            assert.notInclude(["code", "default"], byRole);
            const denied = yield* delegate(service, {
              task: "Implement it.",
              role: "implementation",
              interactionMode: "default",
              mode: "async",
              clientRequestId: `explicit-${mode}`,
            }).pipe(Effect.flip);
            assert.equal(denied.code, "interaction_mode_escalation_denied");
          }),
      ),
  );
});

describe("limits on a lead's delegation", () => {
  const selection = { instanceId: own, model: "claude-own-model" };
  const live = (name: string) =>
    shell(ThreadId.make(name), {
      lineage: { parentThreadId: leadId, relationshipToParent: "subagent", rootThreadId: leadId },
      status: "running",
      activityRunStatus: "running",
    });

  it.effect("refuses the worker after the live cap, with a message the lead can act on", () =>
    run(
      {
        mode: "code",
        leadSelection: selection,
        children: ["w1", "w2", "w3"],
        shells: { w1: live("w1"), w2: live("w2"), w3: live("w3") },
      },
      ({ service, dispatched }) =>
        Effect.gen(function* () {
          const error = yield* delegate(service, {
            task: "One more.",
            mode: "async",
            clientRequestId: "cap",
          }).pipe(Effect.flip);
          assert.equal(error.code, "capability_denied");
          assert.include(error.message, "3 of 3 workers are still running");
          assert.deepEqual(yield* Ref.get(dispatched), []);
        }),
    ),
  );

  it.effect("takes the cap from settings", () =>
    run(
      {
        mode: "code",
        leadSelection: selection,
        children: ["w1", "w2", "w3"],
        shells: { w1: live("w1"), w2: live("w2"), w3: live("w3") },
        settings: { kodoSubAgentsMaxWorkers: 4 },
      },
      ({ service }) =>
        delegate(service, { task: "Fourth.", mode: "async", clientRequestId: "cap-4" }).pipe(
          Effect.asVoid,
        ),
    ),
  );

  it.effect("refuses a worker's delegate_task and create_threads", () =>
    run(
      {
        mode: "code",
        leadSelection: selection,
        callerId: ThreadId.make("thread:worker"),
        shells: {
          "thread:worker": shell(ThreadId.make("thread:worker"), {
            lineage: {
              parentThreadId: leadId,
              relationshipToParent: "subagent",
              rootThreadId: leadId,
            },
          }),
        },
      },
      ({ service, dispatched }) =>
        Effect.gen(function* () {
          const worker = scope(ThreadId.make("thread:worker"));
          const delegated = yield* service
            .delegateTask(worker, { task: "Nested.", mode: "async", clientRequestId: "nested" })
            .pipe(Effect.flip);
          assert.include(delegated.message, "workers do not start workers");
          const created = yield* service
            .createThreads(worker, {
              threads: [{ prompt: "Nested." }],
              clientRequestId: "nested-threads",
            })
            .pipe(Effect.flip);
          assert.include(created.message, "workers do not start workers");
          assert.deepEqual(yield* Ref.get(dispatched), []);
        }),
    ),
  );

  it.effect("refuses before delegating when the worker's provider is at its usage limit", () =>
    run(
      {
        mode: "code",
        leadSelection: selection,
        settings: { loop: { budget: { stopAtLimitPercent: 80 } } } as never,
        usageLimits: {
          checkedAt: DateTime.formatIso(DateTime.makeUnsafe("2026-01-01T00:00:00Z")),
          windows: [{ id: "5h", label: "5 hour", usedPercent: 95, windowDurationMins: 300 }],
        } as never,
      },
      ({ service, dispatched }) =>
        Effect.gen(function* () {
          const error = yield* delegate(service, {
            task: "Go.",
            mode: "async",
            clientRequestId: "limit",
          }).pipe(Effect.flip);
          assert.include(error.message, "usage limit");
          assert.include(error.message, "No worker was started");
          assert.deepEqual(yield* Ref.get(dispatched), []);
        }),
    ),
  );

  it.effect(
    "leaves a thread that does not lead exactly as it was: its model target is honoured",
    () =>
      run({ mode: "code", leadSelection: selection, lead: false }, ({ service, dispatched }) =>
        Effect.gen(function* () {
          yield* delegate(service, {
            task: "Go.",
            mode: "async",
            clientRequestId: "plain",
            target: { providerInstanceId: slotInstance },
          });
          const command = lastCommand(yield* Ref.get(dispatched));
          assert.equal(command.explicitModelSelection, true);
          assert.equal(command.modelSelection.instanceId, slotInstance);
        }),
      ),
  );
});
