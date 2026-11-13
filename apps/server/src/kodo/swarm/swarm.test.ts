// KODO: swarm-guard, orchestrator-rpc - the Orchestrator's setup and what no one may do to its thread.
import { describe, expect, it } from "@effect/vitest";
import {
  KODO_ORCHESTRATOR_PROJECT_ID,
  KODO_ORCHESTRATOR_THREAD_ID,
  kodoOrchestratorThreadIdFor,
  ProviderInstanceId,
  type ModelSelection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import { decideKodoLeadSet } from "../delegation/leadControl.ts";
import { makeKodoSwarmService, type KodoSwarmThreadShell } from "./SwarmService.ts";
import {
  kodoOrchestratorProjectRefusal,
  planKodoOrchestratorProject,
} from "./orchestratorProject.ts";
import { kodoSwarmCommandRefusal, kodoSwarmTaskTargetRefusal } from "./swarmGuard.ts";

const model: ModelSelection = { instanceId: ProviderInstanceId.make("claude-main"), model: "m" };

type Shell = KodoSwarmThreadShell;
const live: Shell = { deletedAt: null, archivedAt: null, modelSelection: model };

interface World {
  /** Threads that exist, by id. */
  readonly threads?: Readonly<Record<string, Shell>>;
  readonly enabled?: boolean;
  readonly model?: ModelSelection | null;
  readonly support?: string | undefined;
  readonly workers?: number;
  readonly projectFails?: { readonly _tag: string };
  readonly dispatchFails?: { readonly _tag: string };
  /** Another ensure made the thread while this create ran: it is live once the create is refused. */
  readonly raced?: boolean;
}

const setup = (world: World = {}) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<string>>([]);
    const created = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([]);
    const note = (what: string) => Ref.update(calls, (all) => [...all, what]);
    const threads: Record<string, Shell> = { ...world.threads };
    const service = makeKodoSwarmService({
      workspaceRoot: "/home/.t3/orchestrator",
      makeFolder: () => note("folder"),
      projects: {
        ensureKodoOrchestratorProject: () =>
          note("project").pipe(
            Effect.andThen(
              world.projectFails === undefined ? Effect.void : Effect.fail(world.projectFails),
            ),
          ),
      },
      threads: {
        // As the projection reads it: a deleted thread has no shell, yet still holds its id.
        getThreadShell: (threadId) =>
          Effect.succeed(threads[threadId]?.deletedAt === null ? threads[threadId] : null),
        isTombstone: (threadId) => Effect.succeed(threads[threadId] !== undefined),
        dispatch: (command) =>
          note(command.type === "thread.create" ? "thread" : command.type).pipe(
            Effect.andThen(Ref.update(created, (all) => [...all, command as never])),
            Effect.andThen(
              world.dispatchFails === undefined
                ? Effect.sync(() => {
                    if (command.type === "thread.create") threads[command.threadId] = live;
                    else threads[command.threadId] = { ...live, archivedAt: null };
                  })
                : Effect.sync(() => {
                    if (world.raced === true && command.type === "thread.create") {
                      threads[command.threadId] = live;
                    }
                  }).pipe(Effect.andThen(Effect.fail(world.dispatchFails))),
            ),
          ),
        deleteThread: (threadId) =>
          note(`delete ${threadId}`).pipe(
            Effect.andThen(
              Effect.sync(() => {
                threads[threadId] = { ...live, deletedAt: "then" };
              }),
            ),
          ),
        liveWorkers: () => Effect.succeed(world.workers ?? 0),
      },
      settings: Effect.succeed({
        enabled: world.enabled ?? true,
        baseModel: world.model === undefined ? model : world.model,
      }),
      supportRefusal: () => Effect.succeed(world.support),
    });
    return { service, calls, created, threads };
  });

describe("ensuring the Orchestrator", () => {
  it.effect(
    "makes the project and the thread once, as the server, read-only by lead and approval ceiling",
    () =>
      Effect.gen(function* () {
        const { service, calls, created } = yield* setup();
        const first = yield* service.ensure;
        expect(first).toEqual({
          projectId: KODO_ORCHESTRATOR_PROJECT_ID,
          threadId: KODO_ORCHESTRATOR_THREAD_ID,
        });
        expect(yield* Ref.get(created)).toMatchObject([
          {
            type: "thread.create",
            createdBy: "system",
            creationSource: "server",
            threadId: KODO_ORCHESTRATOR_THREAD_ID,
            projectId: KODO_ORCHESTRATOR_PROJECT_ID,
            title: "Orchestrator",
            kodoLead: { kind: "swarm" },
            runtimeMode: "approval-required",
            modelSelection: model,
          },
        ]);
        // Asking again finds it, and creates nothing more (the project is checked each time).
        expect(yield* service.ensure).toEqual(first);
        expect(yield* Ref.get(calls)).toEqual(["folder", "project", "thread", "folder", "project"]);
      }),
  );

  it.effect("is the same answer when another ensure created the thread first", () =>
    Effect.gen(function* () {
      const { service } = yield* setup({
        dispatchFails: { _tag: "OrchestratorThreadAlreadyExistsError" },
        raced: true,
      });
      expect((yield* service.ensure).threadId).toBe(KODO_ORCHESTRATOR_THREAD_ID);
    }),
  );

  it.effect("does not take a refused create for a live thread when none is there", () =>
    Effect.gen(function* () {
      const { service } = yield* setup({
        dispatchFails: { _tag: "OrchestratorThreadAlreadyExistsError" },
      });
      expect((yield* service.ensure.pipe(Effect.flip)).reason).toContain("could not be created");
    }),
  );

  it.effect("makes the next conversation when the last one was deleted, instead of failing", () =>
    Effect.gen(function* () {
      const { service, created } = yield* setup({
        threads: { [KODO_ORCHESTRATOR_THREAD_ID]: { ...live, deletedAt: "then" } },
      });
      const result = yield* service.ensure;
      expect(result.threadId).toBe(kodoOrchestratorThreadIdFor(2));
      expect(yield* Ref.get(created)).toMatchObject([
        { type: "thread.create", threadId: kodoOrchestratorThreadIdFor(2) },
      ]);
    }),
  );

  it.effect("keeps the newest live conversation and restores one that was archived", () =>
    Effect.gen(function* () {
      const { service, created } = yield* setup({
        threads: {
          [KODO_ORCHESTRATOR_THREAD_ID]: { ...live, deletedAt: "then" },
          [kodoOrchestratorThreadIdFor(2)]: { ...live, archivedAt: "then" },
        },
      });
      expect((yield* service.ensure).threadId).toBe(kodoOrchestratorThreadIdFor(2));
      expect(yield* Ref.get(created)).toMatchObject([
        { type: "thread.unarchive", threadId: kodoOrchestratorThreadIdFor(2) },
      ]);
    }),
  );

  it.effect("says why the project could not be made, and makes no thread", () =>
    Effect.gen(function* () {
      const { service, created } = yield* setup({ projectFails: { _tag: "ProjectConflictError" } });
      const failure = yield* service.ensure.pipe(Effect.flip);
      expect(failure.reason).toContain("project could not be made");
      expect(yield* Ref.get(created)).toEqual([]);
    }),
  );

  it.effect.each([
    { name: "no default model", world: { model: null }, reason: "Choose a default model" },
    { name: "the setting off", world: { enabled: false }, reason: "turned off" },
    {
      name: "a provider that cannot receive the tools",
      world: { support: "This provider cannot receive the T3 tools." },
      reason: "cannot receive the T3 tools",
    },
    {
      name: "a failing thread create",
      world: { dispatchFails: { _tag: "Other" } },
      reason: "could not be created",
    },
  ])("fails clearly with $name, and creates nothing", ({ world, reason }) =>
    Effect.gen(function* () {
      const { service, threads } = yield* setup(world);
      expect((yield* service.ensure.pipe(Effect.flip)).reason).toContain(reason);
      expect(Object.keys(threads)).toEqual([]);
    }),
  );

  it.effect.each([
    {
      name: "a provider that cannot receive the tools",
      world: { support: "Nope." },
      warning: "Nope.",
    },
  ])(
    "still opens a conversation that exists with $name, and says why it will not run",
    ({ world, warning }) =>
      Effect.gen(function* () {
        const { service, created } = yield* setup({
          threads: { [KODO_ORCHESTRATOR_THREAD_ID]: live },
          ...world,
        });
        const result = yield* service.ensure;
        expect(result.threadId).toBe(KODO_ORCHESTRATOR_THREAD_ID);
        expect(result.warning).toContain(warning);
        expect(yield* Ref.get(created)).toEqual([]);
      }),
  );

  it.effect(
    "gives no warning for a conversation that exists with the setting off: it still runs",
    () =>
      Effect.gen(function* () {
        const { service } = yield* setup({
          threads: { [KODO_ORCHESTRATOR_THREAD_ID]: live },
          enabled: false,
        });
        expect((yield* service.ensure).warning).toBeUndefined();
      }),
  );

  it.effect("gives no warning when a conversation that exists can run", () =>
    Effect.gen(function* () {
      const { service } = yield* setup({ threads: { [KODO_ORCHESTRATOR_THREAD_ID]: live } });
      expect((yield* service.ensure).warning).toBeUndefined();
    }),
  );
});

describe("resetting the Orchestrator", () => {
  it.effect("deletes the conversation and starts the next, which ensure then finds", () =>
    Effect.gen(function* () {
      const { service, calls } = yield* setup({ threads: { [KODO_ORCHESTRATOR_THREAD_ID]: live } });
      const result = yield* service.reset;
      expect(result.threadId).toBe(kodoOrchestratorThreadIdFor(2));
      expect(yield* service.ensure).toEqual(result);
      expect(
        (yield* Ref.get(calls)).filter((call) => call !== "folder" && call !== "project"),
      ).toEqual([`delete ${KODO_ORCHESTRATOR_THREAD_ID}`, "thread"]);
    }),
  );

  it.effect.each([
    { name: "live workers", world: { workers: 2 }, reason: "2 workers are still running" },
    { name: "one live worker", world: { workers: 1 }, reason: "1 worker is still running" },
    {
      name: "a turn in progress",
      world: { threads: { [KODO_ORCHESTRATOR_THREAD_ID]: { ...live, activeRunId: "run" } } },
      reason: "middle of a turn",
    },
    {
      name: "a question waiting",
      world: {
        threads: { [KODO_ORCHESTRATOR_THREAD_ID]: { ...live, pendingRuntimeRequest: { id: "r" } } },
      },
      reason: "waiting on you",
    },
    { name: "no default model", world: { model: null }, reason: "Choose a default model" },
    { name: "an unsupported provider", world: { support: "Nope." }, reason: "Nope." },
    { name: "the setting off", world: { enabled: false }, reason: "turned off" },
  ])("is refused with $name, and deletes nothing", ({ world, reason }) =>
    Effect.gen(function* () {
      const { service, calls } = yield* setup({
        threads: { [KODO_ORCHESTRATOR_THREAD_ID]: live },
        ...world,
      });
      expect((yield* service.reset.pipe(Effect.flip)).reason).toContain(reason);
      expect((yield* Ref.get(calls)).some((call) => call.startsWith("delete"))).toBe(false);
    }),
  );

  it.effect("just makes the conversation when there is none to reset", () =>
    Effect.gen(function* () {
      const { service } = yield* setup();
      expect((yield* service.reset).threadId).toBe(KODO_ORCHESTRATOR_THREAD_ID);
    }),
  );
});

describe("turning the Orchestrator off", () => {
  it.effect("is refused while its workers run, with the reason", () =>
    Effect.gen(function* () {
      const { service } = yield* setup({
        threads: { [KODO_ORCHESTRATOR_THREAD_ID]: live },
        workers: 1,
      });
      const refused = yield* service
        .guardSettingsPatch({ kodoOrchestratorEnabled: false })
        .pipe(Effect.flip);
      expect(refused.message).toContain("Stop all");
    }),
  );

  it.effect.each([
    {
      name: "a turn in progress",
      shell: { ...live, activeRunId: "run" },
    },
    {
      name: "a question waiting",
      shell: { ...live, pendingRuntimeRequest: { id: "r" } },
    },
  ])("is refused with $name, with the reason", ({ shell }) =>
    Effect.gen(function* () {
      const { service } = yield* setup({ threads: { [KODO_ORCHESTRATOR_THREAD_ID]: shell } });
      const refused = yield* service
        .guardSettingsPatch({ kodoOrchestratorEnabled: false })
        .pipe(Effect.flip);
      expect(refused.operation).toBe("orchestrator-off-while-busy");
      expect(refused.message).toContain("middle of a turn");
    }),
  );

  it.effect.each([
    { name: "no workers run", world: { workers: 0 }, patch: { kodoOrchestratorEnabled: false } },
    { name: "it is turned on", world: { workers: 2 }, patch: { kodoOrchestratorEnabled: true } },
    { name: "the patch leaves it", world: { workers: 2 }, patch: {} },
    {
      name: "it is already off",
      world: { workers: 2, enabled: false },
      patch: { kodoOrchestratorEnabled: false },
    },
  ])("is allowed when $name", ({ world, patch }) =>
    Effect.gen(function* () {
      const { service } = yield* setup({
        threads: { [KODO_ORCHESTRATOR_THREAD_ID]: live },
        ...world,
      });
      yield* service.guardSettingsPatch(patch);
    }),
  );
});

describe("a task that names another project", () => {
  const task = {
    targetProjectId: "project-acme",
    parentIsSwarm: true,
    target: { archivedAt: null },
  };

  it("is honored only from the server's own start, never a client's command", () => {
    expect(kodoSwarmTaskTargetRefusal({ ...task, createdBy: "agent" })).toBeUndefined();
    for (const createdBy of ["user", "system"]) {
      expect(kodoSwarmTaskTargetRefusal({ ...task, createdBy })).toContain("approved start");
    }
  });

  it("is refused for the Orchestrator's task from a client whatever it names, and needs a project from the server", () => {
    const noProject = { ...task, targetProjectId: undefined };
    for (const createdBy of ["user", "system"]) {
      expect(kodoSwarmTaskTargetRefusal({ ...noProject, createdBy })).toContain("approved start");
    }
    expect(kodoSwarmTaskTargetRefusal({ ...noProject, createdBy: "agent" })).toContain(
      "project it names",
    );
    // Any other thread's task without a project is an ordinary one.
    for (const createdBy of ["user", "agent"]) {
      expect(
        kodoSwarmTaskTargetRefusal({ ...noProject, createdBy, parentIsSwarm: false }),
      ).toBeUndefined();
    }
  });

  it("is still refused for another thread, its own project, a missing or archived project", () => {
    const refused = (change: Record<string, unknown>) =>
      kodoSwarmTaskTargetRefusal({ ...task, createdBy: "agent", ...change });
    expect(refused({ parentIsSwarm: false })).toContain("Only the Orchestrator");
    expect(refused({ targetProjectId: KODO_ORCHESTRATOR_PROJECT_ID })).toContain("never its own");
    expect(refused({ target: undefined })).toContain("does not exist");
    expect(refused({ target: { archivedAt: "then" } })).toContain("archived");
  });
});

describe("what no one may do to the Orchestrator's thread", () => {
  const thread = KODO_ORCHESTRATOR_THREAD_ID;
  const refused = (command: Record<string, unknown>) =>
    kodoSwarmCommandRefusal({ type: "x", ...command });

  it.each([
    "thread.delete",
    "thread.archive",
    "thread.interaction-mode.set",
    "thread.runtime-mode.set",
    "thread.metadata.update",
    "thread.project.adopt-folder",
    "thread.kodo-lead.set",
  ])("refuses %s on it, and allows it elsewhere", (type) => {
    expect(refused({ type, threadId: thread })).toContain("managed by the server");
    expect(refused({ type, threadId: "another-thread" })).toBeUndefined();
  });

  it("holds for every conversation of its series, and for no other id", () => {
    const next = kodoOrchestratorThreadIdFor(3);
    expect(refused({ type: "thread.delete", threadId: next })).toContain("managed by the server");
    expect(refused({ type: "thread.delete", threadId: `${thread}-x` })).toBeUndefined();
    expect(refused({ type: "thread.delete", threadId: `${thread}-1` })).toBeUndefined();
    expect(refused({ type: "thread.delete", threadId: `x${thread}` })).toBeUndefined();
  });

  it("keeps its title: a generated one is refused, closing the request without one is not", () => {
    const type = "thread.title.regeneration.complete";
    expect(refused({ type, threadId: thread, title: "Fix the build" })).toContain("managed");
    expect(refused({ type, threadId: thread })).toBeUndefined();
    expect(refused({ type, threadId: "another-thread", title: "Fix the build" })).toBeUndefined();
  });

  it("refuses a fork or merge of it, and any thread made in its project or under its id", () => {
    expect(refused({ type: "thread.fork", sourceThreadId: thread })).toBeDefined();
    expect(
      refused({ type: "thread.merge_back", sourceThreadId: "a", targetThreadId: thread }),
    ).toBeDefined();
    expect(refused({ type: "thread.fork", sourceThreadId: "a" })).toBeUndefined();
    for (const createdBy of ["user", "agent"]) {
      expect(
        refused({ type: "thread.create", createdBy, threadId: thread, projectId: "p" }),
      ).toBeDefined();
      expect(
        refused({
          type: "thread.create",
          createdBy,
          threadId: "t",
          projectId: KODO_ORCHESTRATOR_PROJECT_ID,
        }),
      ).toBeDefined();
    }
    expect(
      refused({
        type: "thread.create",
        createdBy: "system",
        threadId: thread,
        projectId: KODO_ORCHESTRATOR_PROJECT_ID,
      }),
    ).toBeUndefined();
    expect(
      refused({ type: "thread.create", createdBy: "user", threadId: "t", projectId: "p" }),
    ).toBeUndefined();
  });

  it("leaves messages, stops and model picks alone", () => {
    for (const type of [
      "message.dispatch",
      "thread.stop",
      "thread.model-selection.set",
      "thread.visit",
    ]) {
      expect(refused({ type, threadId: thread })).toBeUndefined();
    }
  });

  it("is never made a sub-agents lead, or switched off, by anyone", () => {
    const decide = (requested: { kind: "sub-agents" } | null) =>
      decideKodoLeadSet({
        requested,
        thread: { id: thread, interactionMode: "code", lead: { kind: "swarm" } },
        busy: false,
        liveWorkers: 0,
        underLead: false,
        supportRefusal: undefined,
        actor: { createdBy: "user", senderIsTargetOrAncestor: false },
      });
    expect(decide(null)).toMatchObject({ ok: false });
    expect(decide({ kind: "sub-agents" })).toMatchObject({ ok: false });
  });
});

describe("the Orchestrator's project", () => {
  it("is refused to every caller, and no other project is", () => {
    expect(kodoOrchestratorProjectRefusal(KODO_ORCHESTRATOR_PROJECT_ID)).toContain(
      "managed by the server",
    );
    expect(kodoOrchestratorProjectRefusal("some-project")).toBeUndefined();
  });

  const row = (over: Record<string, unknown> = {}) => ({
    deletedAt: null,
    archivedAt: null,
    workspaceRoot: "/home/.t3/orchestrator",
    updatedAt: "t1",
    ...over,
  });
  const plan = (existing: ReturnType<typeof row> | undefined) =>
    planKodoOrchestratorProject({ existing, workspaceRoot: "/home/.t3/orchestrator" });

  it("is made when missing or deleted, put right when archived or moved, and left alone otherwise", () => {
    expect(plan(undefined)).toMatchObject({
      type: "create",
      commandId: "kodo-orchestrator:project",
    });
    expect(plan(row({ deletedAt: "d1" }))).toMatchObject({
      type: "create",
      commandId: "kodo-orchestrator:project:restore:d1",
    });
    expect(plan(row({ archivedAt: "a1" }))).toMatchObject({
      type: "repair",
      workspaceRoot: undefined,
    });
    expect(plan(row({ workspaceRoot: "/elsewhere" }))).toMatchObject({
      type: "repair",
      workspaceRoot: "/home/.t3/orchestrator",
    });
    expect(plan(row())).toBeUndefined();
  });
});
