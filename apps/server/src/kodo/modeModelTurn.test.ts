// KODO: mode-models-turn - which turns may change model, and what each one records.
import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_KODO_MODE_MODELS,
  ProviderInstanceId,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadProjection,
  type ServerProvider,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";

import { type KodoDispatchSelectionInput, makeKodoModeModelTurn } from "./modeModelTurn.ts";

const sel = (instance: string, model: string) =>
  createModelSelection(ProviderInstanceId.make(instance), model);
const own = sel("claudeAgent", "own");
const ask = sel("codex", "ask-model");
const code = sel("claudeAgent", "code-model");
const picked = sel("claudeAgent", "picked");

const provider = (instanceId: string, overrides: Partial<ServerProvider> = {}) =>
  ({
    instanceId,
    driver: instanceId,
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    models: [],
    ...overrides,
  }) as unknown as ServerProvider;

const makeTurn = (input: {
  readonly modeModelSelections: Partial<typeof DEFAULT_KODO_MODE_MODELS>;
  readonly providers?: ReadonlyArray<ServerProvider>;
  readonly projectOverrides?: unknown;
}) =>
  makeKodoModeModelTurn({
    serverSettings: {
      getSettings: Effect.succeed({
        modeModelSelections: { ...DEFAULT_KODO_MODE_MODELS, ...input.modeModelSelections },
        providerInstances: {},
        projectSettingsOverrides: input.projectOverrides ?? {},
      }),
    } as never,
    providerRegistry: {
      getProviders: Effect.succeed(input.providers ?? [provider("claudeAgent"), provider("codex")]),
    } as never,
    providerSwitchService: {
      plan: () =>
        Effect.succeed({
          transition: { type: "apply_on_next_turn" },
          releaseProviderSessionIds: [],
          instanceChanged: false,
        }),
    } as never,
    sessionHasBackgroundWork: () => Effect.succeed(false),
  });

const run = (overrides: Partial<OrchestrationV2Run> & Pick<OrchestrationV2Run, "id">) =>
  ({ status: "queued", ...overrides }) as unknown as OrchestrationV2Run;

const projectionOf = (input: {
  readonly mode: string;
  /** The thread leads sub-agents. */
  readonly lead?: boolean;
  readonly modelSelection?: typeof own;
  readonly kodoModeModel?: { applied: typeof own; base: typeof own };
  readonly runs?: ReadonlyArray<OrchestrationV2Run>;
}) =>
  ({
    thread: {
      projectId: "project",
      interactionMode: input.mode,
      ...(input.lead === true ? { kodoLead: { kind: "sub-agents" } } : {}),
      modelSelection: input.modelSelection ?? own,
      ...(input.kodoModeModel === undefined ? {} : { kodoModeModel: input.kodoModeModel }),
    },
    runs: input.runs ?? [],
    messages: [],
    providerSessions: [],
    providerThreads: [],
  }) as unknown as OrchestrationV2ThreadProjection;

const dispatchInput = (
  projection: OrchestrationV2ThreadProjection,
  overrides: Partial<KodoDispatchSelectionInput> & {
    readonly command?: KodoDispatchSelectionInput["command"];
  } = {},
): KodoDispatchSelectionInput => ({
  projection,
  command: {},
  modelSelection: projection.thread.modelSelection,
  followsCurrentConversation: false,
  queueTail: undefined,
  activeProviderThread: undefined,
  ...overrides,
});

describe("selectForDispatch for a lead", () => {
  // KODO: delegation-lead-model - a lead's turns read the Orchestrator slot, whatever its mode has.
  const orchestrator = sel("codex", "lead-model");
  it.effect("runs on the Orchestrator model, not the mode's, and records the thread's own", () =>
    Effect.gen(function* () {
      const turn = makeTurn({ modeModelSelections: { code, orchestrator } });
      const result = yield* turn.selectForDispatch(
        dispatchInput(projectionOf({ mode: "code", lead: true })),
      );
      expect(result.modelSelection).toEqual(orchestrator);
      expect(result.kodoRunModel).toEqual({ source: "mode-default", base: own });
    }),
  );

  it.effect(
    "runs on the thread's own model when no Orchestrator model is set, even if its mode has one",
    () =>
      Effect.gen(function* () {
        const turn = makeTurn({ modeModelSelections: { code } });
        const result = yield* turn.selectForDispatch(
          dispatchInput(projectionOf({ mode: "code", lead: true })),
        );
        expect(result.modelSelection).toEqual(own);
      }),
  );

  it.effect("lets a person's pick win for that message and keeps the lead model for the next", () =>
    Effect.gen(function* () {
      const turn = makeTurn({ modeModelSelections: { orchestrator } });
      const pick = yield* turn.selectForDispatch(
        dispatchInput(projectionOf({ mode: "code", lead: true }), {
          command: { modelSelection: picked, explicitModelSelection: true },
        }),
      );
      expect(pick.modelSelection).toEqual(picked);
      expect(pick.kodoRunModel?.source).toBe("explicit");
    }),
  );

  it.effect(
    "falls back to the thread's own model, with the reason, when the Orchestrator model's provider cannot receive the tools",
    () =>
      Effect.gen(function* () {
        const turn = makeTurn({
          modeModelSelections: { orchestrator },
          providers: [provider("claudeAgent"), provider("codex", { driver: "mystery" as never })],
        });
        const result = yield* turn.selectForDispatch(
          dispatchInput(projectionOf({ mode: "code", lead: true })),
        );
        expect(result.modelSelection).toEqual(own);
        expect(result.kodoRunModel?.unavailable?.reason).toBe(
          "its provider cannot receive the delegation tools",
        );
      }),
  );

  it.effect("does not touch a thread that does not lead", () =>
    Effect.gen(function* () {
      const turn = makeTurn({ modeModelSelections: { code, orchestrator } });
      const result = yield* turn.selectForDispatch(dispatchInput(projectionOf({ mode: "code" })));
      expect(result.modelSelection).toEqual(code);
    }),
  );
});

describe("selectForDispatch", () => {
  it.effect(
    "a send that carries nothing runs on the mode's default and records the thread's own",
    () =>
      Effect.gen(function* () {
        const turn = makeTurn({ modeModelSelections: { ask } });
        const result = yield* turn.selectForDispatch(dispatchInput(projectionOf({ mode: "ask" })));
        expect(result.modelSelection).toEqual(ask);
        expect(result.kodoRunModel).toEqual({ source: "mode-default", base: own });
      }),
  );

  it.effect(
    "compaction for the idle timer or a return, and every notification, keep the thread's model",
    () =>
      Effect.gen(function* () {
        const turn = makeTurn({ modeModelSelections: { ask } });
        const projection = projectionOf({ mode: "ask" });
        for (const command of [
          { idleCompaction: "beforeCacheExpires" as const },
          { idleCompaction: "onReturn" as const },
          {
            notification: {
              source: { kind: "system" as const },
              outcome: "updated" as const,
              summary: "wake",
            },
          },
        ]) {
          const result = yield* turn.selectForDispatch(dispatchInput(projection, { command }));
          expect(result).toEqual({ modelSelection: own, kodoRunModel: undefined });
        }
        const wake = yield* turn.selectForDispatch(
          dispatchInput(projection, { followsCurrentConversation: true }),
        );
        expect(wake.modelSelection).toEqual(own);
      }),
  );

  it.effect(
    "a queued message takes its model from its own mode, never from the run ahead of it",
    () =>
      Effect.gen(function* () {
        // Q1, queued in Ask, runs on the Ask default; the thread then moves to Code, which has none.
        const turn = makeTurn({ modeModelSelections: { ask } });
        const queuedAsk = run({
          id: "run-1" as never,
          modelSelection: ask,
          kodoModel: { source: "mode-default", base: own },
        });
        const result = yield* turn.selectForDispatch(
          dispatchInput(projectionOf({ mode: "code", runs: [queuedAsk] }), {
            modelSelection: ask,
            queueTail: queuedAsk,
          }),
        );
        expect(result.modelSelection).toEqual(own);
        // And a Code default is not displaced by the Ask run ahead of it either.
        const withCode = makeTurn({ modeModelSelections: { ask, code } });
        const second = yield* withCode.selectForDispatch(
          dispatchInput(projectionOf({ mode: "code", runs: [queuedAsk] }), {
            modelSelection: ask,
            queueTail: queuedAsk,
          }),
        );
        expect(second.modelSelection).toEqual(code);
        expect(second.kodoRunModel).toEqual({ source: "mode-default", base: own });
      }),
  );

  it.effect(
    "a pick in a mode with a default is one message's: the thread's own model is recorded as its base",
    () =>
      Effect.gen(function* () {
        const turn = makeTurn({ modeModelSelections: { ask } });
        const result = yield* turn.selectForDispatch(
          dispatchInput(projectionOf({ mode: "ask" }), {
            command: { modelSelection: picked, explicitModelSelection: true },
            modelSelection: picked,
          }),
        );
        expect(result.modelSelection).toEqual(picked);
        expect(result.kodoRunModel).toEqual({ source: "explicit", base: own });
        // Without a default the pick becomes the thread's model.
        const none = yield* makeTurn({ modeModelSelections: {} }).selectForDispatch(
          dispatchInput(projectionOf({ mode: "ask" }), {
            command: { modelSelection: picked, explicitModelSelection: true },
            modelSelection: picked,
          }),
        );
        expect(none).toEqual({ modelSelection: picked, kodoRunModel: undefined });
      }),
  );

  it.effect("a default that cannot run falls back to the thread's model with the reason", () =>
    Effect.gen(function* () {
      const turn = makeTurn({
        modeModelSelections: { ask },
        providers: [provider("claudeAgent"), provider("codex", { enabled: false })],
      });
      const result = yield* turn.selectForDispatch(dispatchInput(projectionOf({ mode: "ask" })));
      expect(result.modelSelection).toEqual(own);
      expect(result.kodoRunModel?.source).toBe("thread");
      expect(result.kodoRunModel?.unavailable?.wanted).toEqual(ask);
      expect(result.kodoRunModel?.unavailable?.reason).toContain("turned off");
      const offForProject = makeTurn({
        modeModelSelections: { ask },
        projectOverrides: { project: { providerInstances: { codex: { enabled: false } } } },
      });
      expect(
        (yield* offForProject.selectForDispatch(dispatchInput(projectionOf({ mode: "ask" }))))
          .kodoRunModel?.unavailable?.reason,
      ).toContain("for this project");
    }),
  );

  it.effect(
    "a continuation keeps its model and the base it records follows the thread's own model now",
    () =>
      Effect.gen(function* () {
        const turn = makeTurn({ modeModelSelections: { ask } });
        const source = run({
          id: "run-1" as never,
          status: "interrupted" as never,
          modelSelection: ask,
          kodoModel: { source: "mode-default", base: own },
        });
        // The thread's own model was changed while the run was down.
        const moved = sel("claudeAgent", "moved");
        const result = yield* turn.selectForDispatch(
          dispatchInput(projectionOf({ mode: "ask", modelSelection: moved, runs: [source] }), {
            command: { restartContinuationOfRunId: "run-1" as never },
            modelSelection: ask,
          }),
        );
        expect(result.modelSelection).toEqual(ask);
        expect(result.kodoRunModel).toEqual({ source: "mode-default", base: moved });
      }),
  );
});

describe("reconcileQueuedStart", () => {
  const providerThreadFor = () => ({ id: "provider-thread-own" }) as never;

  it.effect("starts with the thread's own model as of now, not the one read at queue time", () =>
    Effect.gen(function* () {
      const turn = makeTurn({ modeModelSelections: { ask } });
      const moved = sel("claudeAgent", "moved");
      const queued = run({
        id: "run-1" as never,
        modelSelection: ask,
        providerInstanceId: ask.instanceId,
        kodoModel: { source: "mode-default", base: own },
      });
      const result = yield* turn.reconcileQueuedStart({
        projection: projectionOf({ mode: "ask", modelSelection: moved }),
        run: queued,
        activeProviderThread: undefined,
        providerThreadFor,
      });
      expect(result.run.modelSelection).toEqual(ask);
      expect(result.run.kodoModel).toEqual({ source: "mode-default", base: moved });
    }),
  );

  it.effect(
    "a default whose provider went away by start time falls back to the thread's own model",
    () =>
      Effect.gen(function* () {
        const turn = makeTurn({
          modeModelSelections: { ask },
          providers: [provider("claudeAgent"), provider("codex", { installed: false })],
        });
        const queued = run({
          id: "run-1" as never,
          modelSelection: ask,
          providerInstanceId: ask.instanceId,
          kodoModel: { source: "mode-default", base: own },
        });
        const result = yield* turn.reconcileQueuedStart({
          projection: projectionOf({ mode: "ask" }),
          run: queued,
          activeProviderThread: undefined,
          providerThreadFor,
        });
        expect(result.run.modelSelection).toEqual(own);
        expect(result.run.providerInstanceId).toBe(own.instanceId);
        expect(result.run.kodoModel).toMatchObject({
          source: "thread",
          base: own,
          unavailable: { wanted: ask, reason: expect.stringContaining("not installed") },
        });
        expect(result.fallbackProviderThread).toBeDefined();
        // A pick the user made is theirs: it is not swapped out.
        const explicit = yield* turn.reconcileQueuedStart({
          projection: projectionOf({ mode: "ask" }),
          run: { ...queued, kodoModel: { source: "explicit", base: own } },
          activeProviderThread: undefined,
          providerThreadFor,
        });
        expect(explicit.run.modelSelection).toEqual(ask);
      }),
  );
});
