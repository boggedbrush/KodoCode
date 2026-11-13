import { assert, it } from "@effect/vitest";
import {
  type ManagedPolicySummary,
  type ModelSelection,
  type OrchestrationV2AppThread,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type RuntimeMode,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import { acpPermissionDisposition } from "@t3tools/provider-acp/server/clientPolicy";
import * as ServerSettings from "../serverSettings.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as RuntimePolicy from "./RuntimePolicy.ts";

const projectId = ProjectId.make("project:runtime-policy");
const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = {
  instanceId: providerInstanceId,
  model: "gpt-5.5",
} satisfies ModelSelection;

function makeThread(input: {
  readonly now: DateTime.Utc;
  readonly worktreePath: string | null;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: OrchestrationV2AppThread["interactionMode"];
  readonly kodoLead?: OrchestrationV2AppThread["kodoLead"];
}): OrchestrationV2AppThread {
  const threadId = ThreadId.make("thread:runtime-policy");
  return {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId,
    title: "Runtime policy",
    providerInstanceId,
    modelSelection,
    runtimeMode: input.runtimeMode ?? "full-access",
    interactionMode: input.interactionMode ?? "default",
    branch: null,
    worktreePath: input.worktreePath,
    activeProviderThreadId: null,
    lineage: {
      parentThreadId: null,
      relationshipToParent: null,
      rootThreadId: threadId,
    },
    forkedFrom: null,
    createdAt: input.now,
    updatedAt: input.now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
    ...(input.kodoLead === undefined ? {} : { kodoLead: input.kodoLead }),
  };
}

const grokInstanceId = ProviderInstanceId.make("grok");
const antigravityInstanceId = ProviderInstanceId.make("antigravity");
const supportedRuntimeModesByInstance = new Map<ProviderInstanceId, ReadonlyArray<RuntimeMode>>([
  [grokInstanceId, ["approval-required", "auto", "full-access"]],
  [antigravityInstanceId, ["approval-required", "auto-accept-edits", "full-access"]],
]);
const providerInstanceFor = (instanceId: ProviderInstanceId) =>
  ({
    driverKind: ProviderDriverKind.make(instanceId),
    snapshot: {
      getSnapshot: Effect.succeed({
        supportedRuntimeModes: supportedRuntimeModesByInstance.get(instanceId),
      } as ServerProvider),
    },
  }) as ProviderInstance;

const layerWithPolicy = (policy?: ManagedPolicySummary) =>
  RuntimePolicy.layerFromProjectStore.pipe(
    Layer.provide(ServerSettings.layerTest({}, policy)),
    Layer.provide(
      Layer.succeed(ProviderInstanceRegistry.ProviderInstanceRegistry, {
        getInstance: (instanceId) => Effect.succeed(providerInstanceFor(instanceId)),
        listInstances: Effect.succeed([]),
        listUnavailable: Effect.succeed([]),
        streamChanges: Stream.empty,
        subscribeChanges: Effect.never,
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectStore.ProjectStoreV2)({
        get: () =>
          Effect.succeedSome({
            projectId,
            title: "Project",
            workspaceRoot: "/project-root",
            defaultModelSelection: null,
            defaultThreadEnvMode: null,
            autoPull: false,
            faviconPath: null,
            projectIcon: null,
            scripts: [],
            pinnedAt: null,
            archivedAt: null,
            createdAt: "2026-06-21T00:00:00.000Z",
            updatedAt: "2026-06-21T00:00:00.000Z",
            deletedAt: null,
          }),
      }),
    ),
  );

const layerTest = layerWithPolicy();

it.layer(layerTest)("RuntimePolicyV2", (it) => {
  it.effect("asks for Antigravity command approval when a stored Auto thread falls back", () =>
    Effect.gen(function* () {
      const policy = yield* RuntimePolicy.RuntimePolicyV2;
      const now = yield* DateTime.now;
      const resolve = (runtimeMode: RuntimeMode) =>
        policy.resolve({
          thread: makeThread({ now, worktreePath: null, runtimeMode }),
          modelSelection: { instanceId: antigravityInstanceId, model: "test-model" },
        });
      const request = {
        sessionId: "session-1",
        toolCall: { toolCallId: "command-1", title: "Run command", kind: "execute" as const },
        options: [{ optionId: "allow", name: "Allow", kind: "allow_once" as const }],
      };
      const auto = yield* resolve("auto");
      assert.equal(auto.runtimeMode, "approval-required");
      assert.equal(acpPermissionDisposition(auto, request), "ask");
      assert.equal(acpPermissionDisposition(yield* resolve("auto-accept-edits"), request), "ask");
      assert.equal(acpPermissionDisposition(yield* resolve("full-access"), request), "allow");
    }),
  );

  it.effect("runs a mode the provider does not offer in Supervised", () =>
    Effect.gen(function* () {
      const policy = yield* RuntimePolicy.RuntimePolicyV2;
      const now = yield* DateTime.now;
      const modeFor = (instanceId: ProviderInstanceId, runtimeMode: RuntimeMode) =>
        policy
          .resolve({
            thread: makeThread({ now, worktreePath: null, runtimeMode }),
            modelSelection: { instanceId, model: "test-model" },
          })
          .pipe(Effect.map((resolved) => resolved.runtimeMode));

      assert.equal(yield* modeFor(grokInstanceId, "auto-accept-edits"), "approval-required");
      assert.equal(yield* modeFor(grokInstanceId, "auto"), "auto");
      assert.equal(yield* modeFor(grokInstanceId, "full-access"), "full-access");
      assert.equal(yield* modeFor(providerInstanceId, "auto-accept-edits"), "auto-accept-edits");
    }),
  );

  // KODO: mode-resolver
  it.effect("resolves Kodo ask and review into provider-specific read-only policies", () =>
    Effect.gen(function* () {
      const policy = yield* RuntimePolicy.RuntimePolicyV2;
      const now = yield* DateTime.now;
      const resolve = (
        instanceId: ProviderInstanceId,
        interactionMode: "ask" | "review" | "code",
      ) =>
        policy.resolve({
          thread: makeThread({ now, worktreePath: null, interactionMode }),
          modelSelection: { instanceId, model: "test-model" },
        });

      // Codex: read-only sandbox and approvals never, so no escalated write can be approved.
      const codexAsk = yield* resolve(providerInstanceId, "ask");
      assert.equal(codexAsk.interactionMode, "default");
      assert.deepEqual(codexAsk.sandboxPolicy, { type: "readOnly" });
      assert.equal(codexAsk.approvalPolicy, "never");
      assert.equal(codexAsk.runtimeMode, "approval-required");
      assert.isTrue(codexAsk.modeReadOnly);
      assert.isString(codexAsk.modeInstructions);

      const grokReview = yield* resolve(grokInstanceId, "review");
      assert.equal(grokReview.interactionMode, "default");
      assert.equal(grokReview.runtimeMode, "approval-required");
      assert.isString(grokReview.modeInstructions);

      const grokCode = yield* resolve(grokInstanceId, "code");
      assert.equal(grokCode.interactionMode, "default");
      assert.equal(grokCode.runtimeMode, "full-access");
      assert.isUndefined(grokCode.modeInstructions);
      assert.isUndefined(grokCode.modeReadOnly);
    }),
  );

  // KODO: mode-resolver - a thread that leads sub-agents resolves a policy that withholds native subagents
  it.effect("marks the policy of a thread that leads sub-agents", () =>
    Effect.gen(function* () {
      const policy = yield* RuntimePolicy.RuntimePolicyV2;
      const now = yield* DateTime.now;
      const resolve = (kodoLead: OrchestrationV2AppThread["kodoLead"]) =>
        policy.resolve({
          thread: makeThread({ now, worktreePath: null, interactionMode: "code", kodoLead }),
          modelSelection,
        });
      assert.isTrue((yield* resolve({ kind: "sub-agents" })).modeBlocksNativeSubagents);
      assert.isUndefined((yield* resolve(null)).modeBlocksNativeSubagents);
    }),
  );

  // KODO: mode-read-only-acp - what the resolved policy does to a permission request, per mode.
  it.effect(
    "auto-denies edits in every read-only mode on the ACP family, shell only in Ask and Plan",
    () =>
      Effect.gen(function* () {
        const policy = yield* RuntimePolicy.RuntimePolicyV2;
        const now = yield* DateTime.now;
        const request = (kind: "read" | "edit" | "execute" | "delete") => ({
          sessionId: "session-1",
          toolCall: { toolCallId: "call-1", title: "Tool", kind },
          options: [{ optionId: "allow", name: "Allow", kind: "allow_once" as const }],
        });
        for (const instanceId of [grokInstanceId, antigravityInstanceId]) {
          const dispositions = (interactionMode: "ask" | "review" | "plan" | "code") =>
            policy
              .resolve({
                thread: makeThread({
                  now,
                  worktreePath: null,
                  interactionMode,
                  runtimeMode: "approval-required",
                }),
                modelSelection: { instanceId, model: "test-model" },
              })
              .pipe(
                Effect.map((resolved) =>
                  (["read", "edit", "delete", "execute"] as const).map((kind) =>
                    acpPermissionDisposition(resolved, request(kind)),
                  ),
                ),
              );
          // Reads always work; mutations and shell are denied without a prompt.
          assert.deepEqual(yield* dispositions("ask"), ["allow", "deny", "deny", "deny"]);
          assert.deepEqual(yield* dispositions("plan"), ["allow", "deny", "deny", "deny"]);
          // Review keeps `git diff` available by leaving shell on user approval; edits stay denied.
          assert.deepEqual(yield* dispositions("review"), ["allow", "deny", "deny", "ask"]);
          // Code keeps upstream's approval prompts.
          assert.deepEqual(yield* dispositions("code"), ["allow", "ask", "ask", "ask"]);
        }
      }),
  );
});

// KODO: mode-resolver - an unresolved driver must fail closed.
it.effect(
  "resolves read-only modes for an unresolved driver without trusting a native plan mode",
  () =>
    Effect.gen(function* () {
      const policy = yield* RuntimePolicy.RuntimePolicyV2;
      const now = yield* DateTime.now;
      for (const interactionMode of ["ask", "review", "plan"] as const) {
        const resolved = yield* policy.resolve({
          thread: makeThread({ now, worktreePath: "/work", interactionMode }),
          modelSelection,
        });
        assert.equal(resolved.interactionMode, "default", interactionMode);
        assert.equal(resolved.runtimeMode, "approval-required", interactionMode);
        assert.isString(resolved.modeInstructions, interactionMode);
        assert.isTrue(resolved.modeReadOnly, interactionMode);
      }
    }).pipe(Effect.provide(RuntimePolicy.layer)),
);

it.effect("resolves read-only modes for the driver a fixture names", () =>
  Effect.gen(function* () {
    const policy = yield* RuntimePolicy.RuntimePolicyV2;
    const now = yield* DateTime.now;
    const resolved = yield* policy.resolve({
      thread: makeThread({ now, worktreePath: "/work", interactionMode: "plan" }),
      modelSelection,
    });
    assert.equal(resolved.interactionMode, "plan");
    assert.isUndefined(resolved.modeInstructions);
  }).pipe(Effect.provide(RuntimePolicy.layerForDriver("codex"))),
);

it.layer(
  layerWithPolicy({
    organization: "Example Corp",
    lockedSettings: [],
    limits: { maxRuntimeMode: "auto-accept-edits" },
  }),
)("RuntimePolicyV2 under a runtime mode ceiling", (it) => {
  it.effect("refuses to start a turn above the ceiling, such as one resumed after a restart", () =>
    Effect.gen(function* () {
      const policy = yield* RuntimePolicy.RuntimePolicyV2;
      const now = yield* DateTime.now;
      const resolve = (runtimeMode: RuntimeMode) =>
        policy.resolve({
          thread: makeThread({ now, worktreePath: "/work", runtimeMode }),
          modelSelection,
        });

      const refused = yield* resolve("full-access").pipe(Effect.flip);
      assert.equal(refused._tag, "RuntimePolicyAboveCeilingError");
      assert.equal(
        refused.message,
        "Example Corp limits threads to Auto-accept edits. Switch this thread's mode to continue.",
      );
      const allowed = yield* resolve("auto-accept-edits");
      assert.equal(allowed.runtimeMode, "auto-accept-edits");
      assert.equal(allowed.maxRuntimeMode, "auto-accept-edits");
    }),
  );
});
