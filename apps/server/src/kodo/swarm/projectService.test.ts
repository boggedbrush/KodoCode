// KODO: swarm-project - the Orchestrator's project is the server's: no caller creates, changes or deletes it,
// and the server alone makes it again, puts it right, or resets the conversation in it.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  KODO_ORCHESTRATOR_PROJECT_ID,
  KODO_ORCHESTRATOR_THREAD_ID,
  type OrchestrationV2AppThread,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../../config.ts";
import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as EventStore from "../../orchestration-v2/EventStore.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as LegacyV1ThreadImporter from "../../orchestration-v2/legacy/LegacyV1ThreadImporter.ts";
import * as ProjectionReplay from "../../orchestration-v2/testkit/ProjectionReplay.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ThreadCommandExecutor from "../../orchestration-v2/ThreadCommandExecutor.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as WorkspacePaths from "../../workspace/WorkspacePaths.ts";
import * as ProjectEnrichmentService from "../../project/ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "../../project/ProjectFaviconResolver.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";

const layerEventPersistence = EventSink.layer.pipe(
  Layer.provideMerge(Layer.merge(EventStore.layer, ProjectionStore.layer)),
);
const layerServices = Layer.mergeAll(
  LegacyV1ThreadImporter.layer.pipe(Layer.provideMerge(layerEventPersistence)),
  ProjectionReplay.layer.pipe(Layer.provide(layerEventPersistence)),
  ProjectStore.layer,
  IdAllocator.layer,
  ThreadCommandExecutor.layer,
  Layer.succeed(WorkspacePaths.WorkspacePaths, {
    normalizeWorkspaceRoot: (workspaceRoot) => Effect.succeed(workspaceRoot),
    resolveRelativePathWithinRoot: ({ workspaceRoot, relativePath }) =>
      Effect.succeed({ absolutePath: `${workspaceRoot}/${relativePath}`, relativePath }),
  }),
).pipe(
  Layer.provideMerge(
    ProjectEnrichmentService.layer.pipe(
      Layer.provide(
        Layer.merge(
          Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
            resolve: () => Effect.succeed(null),
          }),
          Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
            invalidate: () => Effect.void,
            resolvePath: () => Effect.succeed(null),
          }),
        ),
      ),
    ),
  ),
  Layer.provideMerge(ServerSettings.layerTest()),
);
const layerDatabase = SqlitePersistence.layerMemory.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "kodo-swarm-project-" })),
  Layer.provideMerge(NodeServices.layer),
);

const ROOT = "/home/.t3/orchestrator";

/** The project row as an older build left it, in the state `columns` describe. */
const seedOrchestratorProject = Effect.fn("KodoSwarmProjectTest.seed")(function* (
  state: { readonly deletedAt?: string; readonly archivedAt?: string; readonly root?: string } = {},
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO projection_projects (
      project_id, title, workspace_root, default_model_selection_json,
      scripts_json, archived_at, created_at, updated_at, deleted_at
    ) VALUES (
      ${KODO_ORCHESTRATOR_PROJECT_ID}, 'Orchestrator', ${state.root ?? ROOT}, NULL,
      '[]', ${state.archivedAt ?? null}, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
      ${state.deletedAt ?? null}
    )
  `;
});

const threadCreated = (projectId: ProjectId, threadId: ThreadId) => {
  const createdAt = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
  const providerInstanceId = ProviderInstanceId.make("codex");
  const payload: OrchestrationV2AppThread = {
    createdBy: "system",
    creationSource: "server",
    id: threadId,
    projectId,
    title: "Orchestrator",
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "m" },
    runtimeMode: "approval-required",
    interactionMode: "code",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
  return {
    id: EventId.make(`created:${threadId}`),
    type: "thread.created" as const,
    threadId,
    providerInstanceId,
    occurredAt: createdAt,
    payload,
  };
};

const withService = <A, E>(
  body: (
    service: ProjectService.ProjectService["Service"],
  ) => Effect.Effect<
    A,
    E,
    SqlClient.SqlClient | EventSink.EventSinkV2 | ProjectionStore.ProjectionStoreV2
  >,
) =>
  Effect.gen(function* () {
    const service = yield* ProjectService.make;
    return yield* body(service);
  }).pipe(Effect.provide(layerServices.pipe(Layer.provideMerge(layerDatabase))));

const refusedWith = <A>(effect: Effect.Effect<A, ProjectService.ProjectServiceError>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => (error._tag === "ProjectInvalidError" ? error.detail : error._tag)),
  );

it.effect("refuses every caller's create, update and delete of the Orchestrator's project", () =>
  withService((service) =>
    Effect.gen(function* () {
      yield* seedOrchestratorProject();
      const id = (label: string) => CommandId.make(`command:swarm-project:${label}`);
      for (const [label, effect] of [
        [
          "update",
          service.update({
            commandId: id("update"),
            projectId: KODO_ORCHESTRATOR_PROJECT_ID,
            workspaceRoot: "/etc",
          }),
        ],
        [
          "archive",
          service.update({
            commandId: id("archive"),
            projectId: KODO_ORCHESTRATOR_PROJECT_ID,
            archived: true,
          }),
        ],
        [
          "delete",
          service.delete({
            commandId: id("delete"),
            projectId: KODO_ORCHESTRATOR_PROJECT_ID,
            force: true,
          }),
        ],
        [
          "create",
          service.create({
            commandId: id("create"),
            projectId: KODO_ORCHESTRATOR_PROJECT_ID,
            title: "Mine",
            workspaceRoot: "/elsewhere",
          }),
        ],
      ] as const) {
        assert.include(yield* refusedWith(effect), "managed by the server", label);
      }
      const kept = yield* service.getById(KODO_ORCHESTRATOR_PROJECT_ID);
      assert.isTrue(Option.isSome(kept));
      assert.equal(Option.getOrThrow(kept).workspaceRoot, ROOT);
      assert.isNull(Option.getOrThrow(kept).archivedAt);
    }),
  ),
);

it.effect("keeps its conversation through a project delete that someone sends anyway", () =>
  withService((service) =>
    Effect.gen(function* () {
      yield* seedOrchestratorProject();
      const eventSink = yield* EventSink.EventSinkV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      yield* eventSink.write({
        events: [threadCreated(KODO_ORCHESTRATOR_PROJECT_ID, KODO_ORCHESTRATOR_THREAD_ID)],
      });
      yield* service
        .delete({
          commandId: CommandId.make("command:swarm-project:cascade"),
          projectId: KODO_ORCHESTRATOR_PROJECT_ID,
          force: true,
        })
        .pipe(Effect.flip);
      assert.isNull(
        (yield* projections.getThreadProjection(KODO_ORCHESTRATOR_THREAD_ID)).thread.deletedAt,
      );
    }),
  ),
);

it.effect.each([
  { name: "missing", seed: undefined },
  { name: "deleted", seed: { deletedAt: "2026-02-01T00:00:00.000Z" } },
  { name: "archived", seed: { archivedAt: "2026-02-01T00:00:00.000Z" } },
  { name: "moved to another folder", seed: { root: "/somewhere/else" } },
])("makes it again or puts it right when it is $name, and leaves a sound one alone", ({ seed }) =>
  withService((service) =>
    Effect.gen(function* () {
      if (seed !== undefined) yield* seedOrchestratorProject(seed);
      const project = yield* service.ensureKodoOrchestratorProject({ workspaceRoot: ROOT });
      assert.equal(project.id, KODO_ORCHESTRATOR_PROJECT_ID);
      assert.equal(project.workspaceRoot, ROOT);
      assert.isNull(project.archivedAt);
      assert.isNull(project.deletedAt);
      // Asking again changes nothing, and does not fail on the command ids it used.
      const again = yield* service.ensureKodoOrchestratorProject({ workspaceRoot: ROOT });
      assert.equal(again.updatedAt, project.updatedAt);
    }),
  ),
);

it.effect("deletes a conversation of its series for a reset, and no other thread", () =>
  withService((service) =>
    Effect.gen(function* () {
      yield* seedOrchestratorProject();
      const eventSink = yield* EventSink.EventSinkV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const ordinary = ThreadId.make("thread:ordinary");
      yield* eventSink.write({
        events: [
          threadCreated(KODO_ORCHESTRATOR_PROJECT_ID, KODO_ORCHESTRATOR_THREAD_ID),
          threadCreated(KODO_ORCHESTRATOR_PROJECT_ID, ordinary),
        ],
      });
      const refused = yield* service.deleteKodoOrchestratorThread(ordinary).pipe(Effect.flip);
      assert.equal(refused._tag, "ProjectInvalidError");
      assert.isNull((yield* projections.getThreadProjection(ordinary)).thread.deletedAt);
      yield* service.deleteKodoOrchestratorThread(KODO_ORCHESTRATOR_THREAD_ID);
      assert.isNotNull(
        (yield* projections.getThreadProjection(KODO_ORCHESTRATOR_THREAD_ID)).thread.deletedAt,
      );
    }),
  ),
);
