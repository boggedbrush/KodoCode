// KODO: swarm-guard, orchestrator-rpc - the Orchestrator's setup and what no one may do to its thread.
import { describe, expect, it } from "@effect/vitest";
import {
  KODO_ORCHESTRATOR_PROJECT_ID,
  KODO_ORCHESTRATOR_THREAD_ID,
  ProviderInstanceId,
  type ModelSelection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import { decideKodoLeadSet } from "../delegation/leadControl.ts";
import { makeKodoSwarmService } from "./SwarmService.ts";
import { kodoSwarmCommandRefusal } from "./swarmGuard.ts";

const model: ModelSelection = { instanceId: ProviderInstanceId.make("claude-main"), model: "m" };

interface World {
  readonly existing?: { readonly deletedAt: unknown } | null;
  readonly model?: ModelSelection | null;
  readonly projectFails?: unknown;
  readonly dispatchFails?: unknown;
}

const setup = (world: World = {}) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<string>>([]);
    const created = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([]);
    const note = (what: string) => Ref.update(calls, (all) => [...all, what]);
    const state = { threadExists: world.existing ?? null };
    const service = makeKodoSwarmService({
      workspaceRoot: "/home/.t3/orchestrator",
      makeFolder: () => note("folder"),
      projects: {
        bootstrap: () =>
          note("project").pipe(
            Effect.andThen(
              world.projectFails === undefined
                ? Effect.succeed({ project: { id: "p" }, created: true })
                : Effect.fail(world.projectFails),
            ),
          ),
      },
      threads: {
        getThreadShell: () => Effect.succeed(state.threadExists),
        dispatch: (command) =>
          note("thread").pipe(
            Effect.andThen(Ref.update(created, (all) => [...all, command as never])),
            Effect.andThen(
              world.dispatchFails === undefined
                ? Effect.sync(() => {
                    state.threadExists = { deletedAt: null };
                  })
                : Effect.fail(world.dispatchFails as never),
            ),
          ),
      },
      baseModel: Effect.succeed(world.model === undefined ? model : world.model),
    });
    return { service, calls, created };
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
            kodoLead: { kind: "swarm" },
            runtimeMode: "approval-required",
            modelSelection: model,
          },
        ]);
        // Asking again finds it, and does nothing.
        expect(yield* service.ensure).toEqual(first);
        expect(yield* Ref.get(calls)).toEqual(["folder", "project", "thread"]);
      }),
  );

  it.effect("is the same answer when another ensure created the thread first", () =>
    Effect.gen(function* () {
      const { service } = yield* setup({
        dispatchFails: { _tag: "OrchestratorThreadAlreadyExistsError" },
      });
      expect((yield* service.ensure).threadId).toBe(KODO_ORCHESTRATOR_THREAD_ID);
    }),
  );

  it.effect("accepts a project conflict with its own id and no other", () =>
    Effect.gen(function* () {
      const ours = yield* setup({
        projectFails: {
          _tag: "ProjectConflictError",
          conflictingProjectId: KODO_ORCHESTRATOR_PROJECT_ID,
        },
      });
      expect((yield* ours.service.ensure).projectId).toBe(KODO_ORCHESTRATOR_PROJECT_ID);
      const theirs = yield* setup({
        projectFails: { _tag: "ProjectConflictError", conflictingProjectId: "someone-else" },
      });
      const failure = yield* theirs.service.ensure.pipe(Effect.flip);
      expect(failure.reason).toContain("project could not be created");
      expect(yield* Ref.get(theirs.created)).toEqual([]);
    }),
  );

  it.effect.each([
    { name: "no default model", world: { model: null }, reason: "Choose a default model" },
    { name: "a deleted thread", world: { existing: { deletedAt: 1 } }, reason: "was deleted" },
    {
      name: "a failing thread create",
      world: { dispatchFails: { _tag: "Other" } },
      reason: "could not be created",
    },
  ])("fails clearly with $name", ({ world, reason }) =>
    Effect.gen(function* () {
      const { service } = yield* setup(world);
      expect((yield* service.ensure.pipe(Effect.flip)).reason).toContain(reason);
    }),
  );
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
