import { Cause, Effect, Layer, Option, Queue, Ref, Schema, Stream } from "effect";
import {
  type AuthSessionId,
  CommandId,
  EventId,
  type OrchestrationCommand,
  type GitActionProgressEvent,
  type GitManagerServiceError,
  OrchestrationDispatchCommandError,
  type OrchestrationEvent,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  ORCHESTRATION_WS_METHODS,
  ProjectSearchEntriesError,
  ProjectWriteFileError,
  OrchestrationReplayEventsError,
  ThreadId,
  type TerminalEvent,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import { clamp } from "effect/Number";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { RpcSerialization } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";

import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery";
import { ServerAuth } from "./auth/Services/ServerAuth.ts";
import { SessionCredentialService } from "./auth/Services/SessionCredentialService.ts";
import { ServerConfig } from "./config";
import { GitCore } from "./git/Services/GitCore";
import { GitManager } from "./git/Services/GitManager";
import { GitStatusBroadcaster } from "./git/Services/GitStatusBroadcaster";
import { Keybindings } from "./keybindings";
import { Open, resolveAvailableEditors } from "./open";
import { normalizeDispatchCommand } from "./orchestration/Normalizer";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import {
  observeRpcEffect,
  observeRpcStream,
  observeRpcStreamEffect,
} from "./observability/RpcInstrumentation";
import { ProviderRegistry } from "./provider/Services/ProviderRegistry";
import {
  ProviderUsageRegistry,
  type ProviderUsageRegistryShape,
} from "./provider/Services/ProviderUsageRegistry";
import { ServerLifecycleEvents } from "./serverLifecycleEvents";
import { ServerRuntimeStartup } from "./serverRuntimeStartup";
import { ServerSettingsService } from "./serverSettings";
import { TerminalManager } from "./terminal/Services/Manager";
import { WorkspaceEntries } from "./workspace/Services/WorkspaceEntries";
import { WorkspaceFileSystem } from "./workspace/Services/WorkspaceFileSystem";
import { WorkspacePathOutsideRootError } from "./workspace/Services/WorkspacePaths";
import { ProjectSetupScriptRunner } from "./project/Services/ProjectSetupScriptRunner";
import { TextGeneration } from "./git/Services/TextGeneration";
import { ServerEnvironment } from "./environment/Services/ServerEnvironment";
import { makeRpcWebSocketServer } from "./rpcWebSocketServer";

const ENHANCE_SEARCH_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "about",
  "have",
  "what",
  "when",
  "where",
  "your",
  "please",
  "should",
  "would",
  "could",
  "make",
  "need",
  "add",
  "update",
  "fix",
  "change",
  "enhance",
]);

function deriveEnhanceSearchQuery(prompt: string, preset: "minimal" | "balanced" | "vibe") {
  const tokens = prompt.toLowerCase().match(/[a-z0-9_./-]+/g) ?? [];
  const filtered = tokens.filter(
    (token) => token.length > 2 && !ENHANCE_SEARCH_STOP_WORDS.has(token),
  );
  const limit = preset === "balanced" ? 4 : 8;
  const query = filtered.slice(0, limit).join(" ");
  return query.length > 0 ? query : "src";
}

function formatEnhanceWorkspaceContext(entries: ReadonlyArray<{ kind: string; path: string }>) {
  if (entries.length === 0) {
    return "";
  }

  return entries.map((entry) => `- [${entry.kind}] ${entry.path}`).join("\n");
}

interface LiveRpcSessionClients {
  readonly clientIdsBySessionId: Map<AuthSessionId, Set<number>>;
  readonly sessionIdByClientId: Map<number, AuthSessionId>;
}

const SESSION_REVOKED_CLOSE_EVENT = new Socket.CloseEvent(1008, "Session revoked");

const makeWsRpcLayer = () =>
  WsRpcGroup.toLayer(
    Effect.gen(function* () {
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
      const orchestrationEngine = yield* OrchestrationEngineService;
      const checkpointDiffQuery = yield* CheckpointDiffQuery;
      const keybindings = yield* Keybindings;
      const open = yield* Open;
      const gitManager = yield* GitManager;
      const git = yield* GitCore;
      const gitStatusBroadcaster = yield* GitStatusBroadcaster;
      const terminalManager = yield* TerminalManager;
      const providerRegistry = yield* ProviderRegistry;
      const providerUsageRegistryOption = yield* Effect.serviceOption(ProviderUsageRegistry);
      const providerUsageRegistry: ProviderUsageRegistryShape = Option.getOrElse(
        providerUsageRegistryOption,
        () => ({
          getUsages: Effect.succeed([]),
          refresh: () => Effect.succeed([]),
          streamChanges: Stream.empty,
        }),
      );
      const config = yield* ServerConfig;
      const lifecycleEvents = yield* ServerLifecycleEvents;
      const serverSettings = yield* ServerSettingsService;
      const serverEnvironment = yield* ServerEnvironment;
      const startup = yield* ServerRuntimeStartup;
      const workspaceEntries = yield* WorkspaceEntries;
      const workspaceFileSystem = yield* WorkspaceFileSystem;
      const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;
      const textGeneration = yield* TextGeneration;
      const serverCommandId = (tag: string) =>
        CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);

      const appendSetupScriptActivity = (input: {
        readonly threadId: ThreadId;
        readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
        readonly summary: string;
        readonly createdAt: string;
        readonly payload: Record<string, unknown>;
        readonly tone: "info" | "error";
      }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId: serverCommandId("setup-script-activity"),
          threadId: input.threadId,
          activity: {
            id: EventId.makeUnsafe(crypto.randomUUID()),
            tone: input.tone,
            kind: input.kind,
            summary: input.summary,
            payload: input.payload,
            turnId: null,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        });

      const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
        Schema.is(OrchestrationDispatchCommandError)(cause)
          ? cause
          : new OrchestrationDispatchCommandError({
              message: cause instanceof Error ? cause.message : fallbackMessage,
              cause,
            });

      const toBootstrapDispatchCommandCauseError = (cause: Cause.Cause<unknown>) => {
        const error = Cause.squash(cause);
        return Schema.is(OrchestrationDispatchCommandError)(error)
          ? error
          : new OrchestrationDispatchCommandError({
              message:
                error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
              cause,
            });
      };

      const dispatchBootstrapTurnStart = (
        command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
      ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> =>
        Effect.gen(function* () {
          const bootstrap = command.bootstrap;
          const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
          let createdThread = false;
          let targetProjectId = bootstrap?.createThread?.projectId;
          let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
          let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;

          const cleanupCreatedThread = () =>
            createdThread
              ? orchestrationEngine
                  .dispatch({
                    type: "thread.delete",
                    commandId: serverCommandId("bootstrap-thread-delete"),
                    threadId: command.threadId,
                  })
                  .pipe(Effect.ignoreCause({ log: true }))
              : Effect.void;

          const recordSetupScriptLaunchFailure = (input: {
            readonly error: unknown;
            readonly requestedAt: string;
            readonly worktreePath: string;
          }) => {
            const detail =
              input.error instanceof Error ? input.error.message : "Unknown setup failure.";
            return appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.failed",
              summary: "Setup script failed to start",
              createdAt: input.requestedAt,
              payload: {
                detail,
                worktreePath: input.worktreePath,
              },
              tone: "error",
            }).pipe(
              Effect.ignoreCause({ log: false }),
              Effect.flatMap(() =>
                Effect.logWarning("bootstrap turn start failed to launch setup script", {
                  threadId: command.threadId,
                  worktreePath: input.worktreePath,
                  detail,
                }),
              ),
            );
          };

          const recordSetupScriptStarted = (input: {
            readonly requestedAt: string;
            readonly worktreePath: string;
            readonly scriptId: string;
            readonly scriptName: string;
            readonly terminalId: string;
          }) => {
            const payload = {
              scriptId: input.scriptId,
              scriptName: input.scriptName,
              terminalId: input.terminalId,
              worktreePath: input.worktreePath,
            };
            return Effect.all([
              appendSetupScriptActivity({
                threadId: command.threadId,
                kind: "setup-script.requested",
                summary: "Starting setup script",
                createdAt: input.requestedAt,
                payload,
                tone: "info",
              }),
              appendSetupScriptActivity({
                threadId: command.threadId,
                kind: "setup-script.started",
                summary: "Setup script started",
                createdAt: new Date().toISOString(),
                payload,
                tone: "info",
              }),
            ]).pipe(
              Effect.asVoid,
              Effect.catch((error) =>
                Effect.logWarning(
                  "bootstrap turn start launched setup script but failed to record setup activity",
                  {
                    threadId: command.threadId,
                    worktreePath: input.worktreePath,
                    scriptId: input.scriptId,
                    terminalId: input.terminalId,
                    detail:
                      error instanceof Error
                        ? error.message
                        : "Unknown setup activity dispatch failure.",
                  },
                ),
              ),
            );
          };

          const runSetupProgram = () =>
            bootstrap?.runSetupScript && targetWorktreePath
              ? (() => {
                  const worktreePath = targetWorktreePath;
                  const requestedAt = new Date().toISOString();
                  return projectSetupScriptRunner
                    .runForThread({
                      threadId: command.threadId,
                      ...(targetProjectId ? { projectId: targetProjectId } : {}),
                      ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
                      worktreePath,
                    })
                    .pipe(
                      Effect.matchEffect({
                        onFailure: (error) =>
                          recordSetupScriptLaunchFailure({
                            error,
                            requestedAt,
                            worktreePath,
                          }),
                        onSuccess: (setupResult) => {
                          if (setupResult.status !== "started") {
                            return Effect.void;
                          }
                          return recordSetupScriptStarted({
                            requestedAt,
                            worktreePath,
                            scriptId: setupResult.scriptId,
                            scriptName: setupResult.scriptName,
                            terminalId: setupResult.terminalId,
                          });
                        },
                      }),
                    );
                })()
              : Effect.void;

          const bootstrapProgram = Effect.gen(function* () {
            if (bootstrap?.createThread) {
              yield* orchestrationEngine.dispatch({
                type: "thread.create",
                commandId: serverCommandId("bootstrap-thread-create"),
                threadId: command.threadId,
                projectId: bootstrap.createThread.projectId,
                title: bootstrap.createThread.title,
                modelSelection: bootstrap.createThread.modelSelection,
                runtimeMode: bootstrap.createThread.runtimeMode,
                interactionMode: bootstrap.createThread.interactionMode,
                branch: bootstrap.createThread.branch,
                worktreePath: bootstrap.createThread.worktreePath,
                createdAt: bootstrap.createThread.createdAt,
              });
              createdThread = true;
            }

            if (bootstrap?.prepareWorktree) {
              const worktree = yield* git.createWorktree({
                cwd: bootstrap.prepareWorktree.projectCwd,
                branch: bootstrap.prepareWorktree.baseBranch,
                newBranch: bootstrap.prepareWorktree.branch,
                path: null,
              });
              targetWorktreePath = worktree.worktree.path;
              yield* orchestrationEngine.dispatch({
                type: "thread.meta.update",
                commandId: serverCommandId("bootstrap-thread-meta-update"),
                threadId: command.threadId,
                branch: worktree.worktree.branch,
                worktreePath: targetWorktreePath,
              });
            }

            yield* runSetupProgram();

            return yield* orchestrationEngine.dispatch(finalTurnStartCommand);
          });

          return yield* bootstrapProgram.pipe(
            Effect.catchCause((cause) => {
              const dispatchError = toBootstrapDispatchCommandCauseError(cause);
              if (Cause.hasInterruptsOnly(cause)) {
                return Effect.fail(dispatchError);
              }
              return cleanupCreatedThread().pipe(Effect.flatMap(() => Effect.fail(dispatchError)));
            }),
          );
        });

      const dispatchNormalizedCommand = (
        normalizedCommand: OrchestrationCommand,
      ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> => {
        const dispatchEffect =
          normalizedCommand.type === "thread.turn.start" && normalizedCommand.bootstrap
            ? dispatchBootstrapTurnStart(normalizedCommand)
            : orchestrationEngine
                .dispatch(normalizedCommand)
                .pipe(
                  Effect.mapError((cause) =>
                    toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
                  ),
                );

        return startup
          .enqueueCommand(dispatchEffect)
          .pipe(
            Effect.mapError((cause) =>
              toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
            ),
          );
      };

      const loadServerConfig = Effect.gen(function* () {
        const keybindingsConfig = yield* keybindings.loadConfigState;
        const providers = yield* providerRegistry.getProviders;
        const settings = yield* serverSettings.getSettings;
        const environment = yield* serverEnvironment.getDescriptor;

        return {
          environment,
          cwd: config.cwd,
          keybindingsConfigPath: config.keybindingsConfigPath,
          keybindings: keybindingsConfig.keybindings,
          issues: keybindingsConfig.issues,
          providers,
          availableEditors: resolveAvailableEditors(),
          observability: {
            logsDirectoryPath: config.logsDir,
            localTracingEnabled: true,
            ...(config.otlpTracesUrl !== undefined ? { otlpTracesUrl: config.otlpTracesUrl } : {}),
            otlpTracesEnabled: config.otlpTracesUrl !== undefined,
            ...(config.otlpMetricsUrl !== undefined
              ? { otlpMetricsUrl: config.otlpMetricsUrl }
              : {}),
            otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
          },
          settings,
        };
      });

      const refreshGitStatus = (cwd: string) =>
        gitStatusBroadcaster
          .refreshStatus(cwd)
          .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

      return WsRpcGroup.of({
        [ORCHESTRATION_WS_METHODS.getSnapshot]: (_input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getSnapshot,
            projectionSnapshotQuery.getSnapshot().pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetSnapshotError({
                    message: "Failed to load orchestration snapshot",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.dispatchCommand,
            Effect.gen(function* () {
              const normalizedCommand = yield* normalizeDispatchCommand(command);
              const result = yield* dispatchNormalizedCommand(normalizedCommand);
              if (normalizedCommand.type === "thread.archive") {
                yield* terminalManager.close({ threadId: normalizedCommand.threadId }).pipe(
                  Effect.catch((error) =>
                    Effect.logWarning("failed to close thread terminals after archive", {
                      threadId: normalizedCommand.threadId,
                      error: error.message,
                    }),
                  ),
                );
              }
              return result;
            }).pipe(
              Effect.mapError((cause) =>
                Schema.is(OrchestrationDispatchCommandError)(cause)
                  ? cause
                  : new OrchestrationDispatchCommandError({
                      message: "Failed to dispatch orchestration command",
                      cause,
                    }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getTurnDiff,
            checkpointDiffQuery.getTurnDiff(input).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetTurnDiffError({
                    message: "Failed to load turn diff",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getFullThreadDiff,
            checkpointDiffQuery.getFullThreadDiff(input).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetFullThreadDiffError({
                    message: "Failed to load full thread diff",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.replayEvents]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.replayEvents,
            Stream.runCollect(
              orchestrationEngine.readEvents(
                clamp(input.fromSequenceExclusive, {
                  maximum: Number.MAX_SAFE_INTEGER,
                  minimum: 0,
                }),
              ),
            ).pipe(
              Effect.map((events) => Array.from(events)),
              Effect.mapError(
                (cause) =>
                  new OrchestrationReplayEventsError({
                    message: "Failed to replay orchestration events",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [WS_METHODS.subscribeOrchestrationDomainEvents]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeOrchestrationDomainEvents,
            Effect.gen(function* () {
              const snapshot = yield* orchestrationEngine.getReadModel();
              const fromSequenceExclusive = snapshot.snapshotSequence;
              const replayEvents: Array<OrchestrationEvent> = yield* Stream.runCollect(
                orchestrationEngine.readEvents(fromSequenceExclusive),
              ).pipe(
                Effect.map((events) => Array.from(events)),
                Effect.catch(() => Effect.succeed([] as Array<OrchestrationEvent>)),
              );
              const replayStream = Stream.fromIterable(replayEvents);
              const source = Stream.merge(replayStream, orchestrationEngine.streamDomainEvents);
              type SequenceState = {
                readonly nextSequence: number;
                readonly pendingBySequence: Map<number, OrchestrationEvent>;
              };
              const state = yield* Ref.make<SequenceState>({
                nextSequence: fromSequenceExclusive + 1,
                pendingBySequence: new Map<number, OrchestrationEvent>(),
              });

              return source.pipe(
                Stream.mapEffect((event) =>
                  Ref.modify(
                    state,
                    ({
                      nextSequence,
                      pendingBySequence,
                    }): [Array<OrchestrationEvent>, SequenceState] => {
                      if (event.sequence < nextSequence || pendingBySequence.has(event.sequence)) {
                        return [[], { nextSequence, pendingBySequence }];
                      }

                      const updatedPending = new Map(pendingBySequence);
                      updatedPending.set(event.sequence, event);

                      const emit: Array<OrchestrationEvent> = [];
                      let expected = nextSequence;
                      for (;;) {
                        const expectedEvent = updatedPending.get(expected);
                        if (!expectedEvent) {
                          break;
                        }
                        emit.push(expectedEvent);
                        updatedPending.delete(expected);
                        expected += 1;
                      }

                      return [emit, { nextSequence: expected, pendingBySequence: updatedPending }];
                    },
                  ),
                ),
                Stream.flatMap((events) => Stream.fromIterable(events)),
              );
            }),
            { "rpc.aggregate": "orchestration" },
          ),
        [WS_METHODS.serverGetConfig]: (_input) =>
          observeRpcEffect(WS_METHODS.serverGetConfig, loadServerConfig, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverRefreshProviders]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverRefreshProviders,
            providerRegistry.refresh().pipe(Effect.map((providers) => ({ providers }))),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverGetUsageStatus]: (_input) =>
          observeRpcEffect(WS_METHODS.serverGetUsageStatus, providerUsageRegistry.getUsages, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverRefreshUsageStatus]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverRefreshUsageStatus,
            providerUsageRegistry.refresh().pipe(Effect.map((usages) => ({ usages }))),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverUpsertKeybinding]: (rule) =>
          observeRpcEffect(
            WS_METHODS.serverUpsertKeybinding,
            Effect.gen(function* () {
              const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule);
              return { keybindings: keybindingsConfig, issues: [] };
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverGetSettings]: (_input) =>
          observeRpcEffect(WS_METHODS.serverGetSettings, serverSettings.getSettings, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverUpdateSettings]: ({ patch }) =>
          observeRpcEffect(WS_METHODS.serverUpdateSettings, serverSettings.updateSettings(patch), {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverEnhancePrompt]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverEnhancePrompt,
            Effect.gen(function* () {
              const settings = yield* serverSettings.getSettings;
              const workspaceContext =
                input.preset === "minimal"
                  ? undefined
                  : formatEnhanceWorkspaceContext(
                      (yield* workspaceEntries.search({
                        cwd: input.cwd,
                        query: deriveEnhanceSearchQuery(input.prompt, input.preset),
                        limit: input.preset === "balanced" ? 6 : 12,
                      })).entries,
                    );

              return yield* textGeneration.generatePromptEnhancement({
                cwd: input.cwd,
                prompt: input.prompt,
                preset: input.preset,
                ...(workspaceContext ? { workspaceContext } : {}),
                modelSelection: settings.promptEnhanceModelSelection,
              });
            }).pipe(Effect.catch(() => Effect.succeed({ prompt: input.prompt }))),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.projectsSearchEntries]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsSearchEntries,
            workspaceEntries.search(input).pipe(
              Effect.mapError(
                (cause) =>
                  new ProjectSearchEntriesError({
                    message: `Failed to search workspace entries: ${cause.detail}`,
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsWriteFile]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsWriteFile,
            workspaceFileSystem.writeFile(input).pipe(
              Effect.mapError((cause) => {
                const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                  ? "Workspace file path must stay within the project root."
                  : "Failed to write workspace file";
                return new ProjectWriteFileError({
                  message,
                  cause,
                });
              }),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.shellOpenInEditor]: (input) =>
          observeRpcEffect(WS_METHODS.shellOpenInEditor, open.openInEditor(input), {
            "rpc.aggregate": "workspace",
          }),
        [WS_METHODS.subscribeGitStatus]: (input) =>
          observeRpcStream(
            WS_METHODS.subscribeGitStatus,
            gitStatusBroadcaster.streamStatus(input),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitRefreshStatus]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitRefreshStatus,
            gitStatusBroadcaster.refreshStatus(input.cwd),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitPull]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitPull,
            git.pullCurrentBranch(input.cwd).pipe(
              Effect.matchCauseEffect({
                onFailure: (cause) => Effect.failCause(cause),
                onSuccess: (result) =>
                  refreshGitStatus(input.cwd).pipe(Effect.ignore({ log: true }), Effect.as(result)),
              }),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitRunStackedAction]: (input) =>
          observeRpcStream(
            WS_METHODS.gitRunStackedAction,
            Stream.callback<GitActionProgressEvent, GitManagerServiceError>((queue) =>
              gitManager
                .runStackedAction(input, {
                  actionId: input.actionId,
                  progressReporter: {
                    publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
                  },
                })
                .pipe(
                  Effect.matchCauseEffect({
                    onFailure: (cause) => Queue.failCause(queue, cause),
                    onSuccess: () =>
                      refreshGitStatus(input.cwd).pipe(
                        Effect.andThen(Queue.end(queue).pipe(Effect.asVoid)),
                      ),
                  }),
                ),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitResolvePullRequest]: (input) =>
          observeRpcEffect(WS_METHODS.gitResolvePullRequest, gitManager.resolvePullRequest(input), {
            "rpc.aggregate": "git",
          }),
        [WS_METHODS.gitPreparePullRequestThread]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitPreparePullRequestThread,
            gitManager
              .preparePullRequestThread(input)
              .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitListBranches]: (input) =>
          observeRpcEffect(WS_METHODS.gitListBranches, git.listBranches(input), {
            "rpc.aggregate": "git",
          }),
        [WS_METHODS.gitCreateWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitCreateWorktree,
            git.createWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitRemoveWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitRemoveWorktree,
            git.removeWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitCreateBranch]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitCreateBranch,
            git.createBranch(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitCheckout]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitCheckout,
            Effect.scoped(git.checkoutBranch(input)).pipe(
              Effect.tap(() => refreshGitStatus(input.cwd)),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitInit]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitInit,
            git.initRepo(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.terminalOpen]: (input) =>
          observeRpcEffect(WS_METHODS.terminalOpen, terminalManager.open(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalWrite]: (input) =>
          observeRpcEffect(WS_METHODS.terminalWrite, terminalManager.write(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalResize]: (input) =>
          observeRpcEffect(WS_METHODS.terminalResize, terminalManager.resize(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalClear]: (input) =>
          observeRpcEffect(WS_METHODS.terminalClear, terminalManager.clear(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalRestart]: (input) =>
          observeRpcEffect(WS_METHODS.terminalRestart, terminalManager.restart(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalClose]: (input) =>
          observeRpcEffect(WS_METHODS.terminalClose, terminalManager.close(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.subscribeTerminalEvents]: (_input) =>
          observeRpcStream(
            WS_METHODS.subscribeTerminalEvents,
            Stream.callback<TerminalEvent>((queue) =>
              Effect.acquireRelease(
                terminalManager.subscribe((event) => Queue.offer(queue, event)),
                (unsubscribe) => Effect.sync(unsubscribe),
              ),
            ),
            { "rpc.aggregate": "terminal" },
          ),
        [WS_METHODS.subscribeServerConfig]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeServerConfig,
            Effect.gen(function* () {
              const keybindingsUpdates = keybindings.streamChanges.pipe(
                Stream.map((event) => ({
                  version: 1 as const,
                  type: "keybindingsUpdated" as const,
                  payload: {
                    issues: event.issues,
                  },
                })),
              );
              const providerStatuses = providerRegistry.streamChanges.pipe(
                Stream.map((providers) => ({
                  version: 1 as const,
                  type: "providerStatuses" as const,
                  payload: { providers },
                })),
              );
              const settingsUpdates = serverSettings.streamChanges.pipe(
                Stream.map((settings) => ({
                  version: 1 as const,
                  type: "settingsUpdated" as const,
                  payload: { settings },
                })),
              );

              return Stream.concat(
                Stream.make({
                  version: 1 as const,
                  type: "snapshot" as const,
                  config: yield* loadServerConfig,
                }),
                Stream.merge(keybindingsUpdates, Stream.merge(providerStatuses, settingsUpdates)),
              );
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeServerLifecycle]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeServerLifecycle,
            Effect.gen(function* () {
              const snapshot = yield* lifecycleEvents.snapshot;
              const snapshotEvents = Array.from(snapshot.events).toSorted(
                (left, right) => left.sequence - right.sequence,
              );
              const liveEvents = lifecycleEvents.stream.pipe(
                Stream.filter((event) => event.sequence > snapshot.sequence),
              );
              return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents);
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeServerUsageStatus]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeServerUsageStatus,
            Effect.gen(function* () {
              const currentUsages = yield* providerUsageRegistry.getUsages;
              return Stream.concat(
                Stream.make({
                  version: 1 as const,
                  type: "snapshot" as const,
                  usages: currentUsages,
                }),
                providerUsageRegistry.streamChanges.pipe(
                  Stream.map((usages) => ({
                    version: 1 as const,
                    type: "updated" as const,
                    payload: { usages },
                  })),
                ),
              );
            }),
            { "rpc.aggregate": "server" },
          ),
      });
    }),
  );

export const makeWebsocketRpcRouteLayer = () =>
  Layer.unwrap(
    Effect.gen(function* () {
      const sessionCredentials = yield* SessionCredentialService;
      const liveRpcSessionClientsRef = yield* Ref.make<LiveRpcSessionClients>({
        clientIdsBySessionId: new Map(),
        sessionIdByClientId: new Map(),
      });

      const bindRpcClientToSession = (clientId: number, sessionId: AuthSessionId) =>
        Ref.update(liveRpcSessionClientsRef, (current) => {
          const clientIdsBySessionId = new Map(current.clientIdsBySessionId);
          const sessionIdByClientId = new Map(current.sessionIdByClientId);
          const clientIds = new Set(clientIdsBySessionId.get(sessionId) ?? []);
          clientIds.add(clientId);
          clientIdsBySessionId.set(sessionId, clientIds);
          sessionIdByClientId.set(clientId, sessionId);
          return {
            clientIdsBySessionId,
            sessionIdByClientId,
          } satisfies LiveRpcSessionClients;
        });

      const unbindRpcClient = (clientId: number) =>
        Ref.update(liveRpcSessionClientsRef, (current) => {
          const sessionId = current.sessionIdByClientId.get(clientId);
          if (!sessionId) {
            return current;
          }

          const clientIdsBySessionId = new Map(current.clientIdsBySessionId);
          const sessionIdByClientId = new Map(current.sessionIdByClientId);
          const nextClientIds = new Set(clientIdsBySessionId.get(sessionId) ?? []);
          nextClientIds.delete(clientId);
          if (nextClientIds.size === 0) {
            clientIdsBySessionId.delete(sessionId);
          } else {
            clientIdsBySessionId.set(sessionId, nextClientIds);
          }
          sessionIdByClientId.delete(clientId);

          return {
            clientIdsBySessionId,
            sessionIdByClientId,
          } satisfies LiveRpcSessionClients;
        });

      const takeRpcClientIdsForSession = (sessionId: AuthSessionId) =>
        Ref.modify(
          liveRpcSessionClientsRef,
          (current): readonly [ReadonlyArray<number>, LiveRpcSessionClients] => {
            const clientIds = current.clientIdsBySessionId.get(sessionId);
            if (!clientIds || clientIds.size === 0) {
              return [[], current] as const;
            }

            const clientIdsBySessionId = new Map(current.clientIdsBySessionId);
            const sessionIdByClientId = new Map(current.sessionIdByClientId);
            clientIdsBySessionId.delete(sessionId);
            for (const clientId of clientIds) {
              sessionIdByClientId.delete(clientId);
            }

            return [
              Array.from(clientIds),
              {
                clientIdsBySessionId,
                sessionIdByClientId,
              } satisfies LiveRpcSessionClients,
            ] as const;
          },
        );

      const isWebSocketSessionActive = (sessionId: AuthSessionId) =>
        sessionCredentials.listActive().pipe(
          Effect.tapError((cause) =>
            Effect.logError("Failed to re-check websocket session state after upgrade.").pipe(
              Effect.annotateLogs({
                sessionId,
                cause,
              }),
            ),
          ),
          Effect.result,
          Effect.map(
            (result) =>
              result._tag === "Success" &&
              result.success.some((session) => session.sessionId === sessionId),
          ),
        );

      const rpcWebSocketServer = yield* makeRpcWebSocketServer(WsRpcGroup, {
        spanPrefix: "ws.rpc",
        spanAttributes: {
          "rpc.transport": "websocket",
          "rpc.system": "effect-rpc",
        },
      }).pipe(Effect.provide(Layer.mergeAll(makeWsRpcLayer(), RpcSerialization.layerJson)));

      // Revocation is checked again on reconnect, but websocket RPC authenticates only
      // during the upgrade. Closing any live socket for a revoked session is what keeps
      // revocation effective for already-connected clients too.
      yield* Stream.runForEach(sessionCredentials.streamChanges, (change) => {
        if (change.type !== "clientRemoved") {
          return Effect.void;
        }
        return takeRpcClientIdsForSession(change.sessionId).pipe(
          Effect.flatMap((clientIds) =>
            Effect.forEach(
              clientIds,
              (clientId) => rpcWebSocketServer.closeClient(clientId, SESSION_REVOKED_CLOSE_EVENT),
              {
                concurrency: "unbounded",
                discard: true,
              },
            ),
          ),
        );
      }).pipe(Effect.forkScoped);

      return HttpRouter.add(
        "GET",
        "/ws",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const config = yield* ServerConfig;
          const serverAuth = yield* ServerAuth;
          const url = HttpServerRequest.toURL(request);

          if (config.authToken && Option.isSome(url)) {
            const token = url.value.searchParams.get("token");
            if (token === config.authToken) {
              return yield* rpcWebSocketServer.handleRequest();
            }
          }

          const authenticatedTransportRequired = config.authToken
            ? true
            : yield* serverAuth.isAuthenticatedTransportRequired();

          if (!authenticatedTransportRequired) {
            return yield* rpcWebSocketServer.handleRequest();
          }

          // Keep legacy `?token=` support for desktop flows, but once the server has been
          // claimed or an explicit auth token exists, websocket RPC must bind to a real
          // authenticated session so `/api/auth/ws-token` and presence tracking both work.
          return yield* serverAuth.authenticateWebSocketUpgrade(request).pipe(
            Effect.flatMap((session) =>
              rpcWebSocketServer.handleRequest({
                onClientConnected: (clientId) =>
                  Effect.gen(function* () {
                    // Register the socket before the active-session check so a revoke that
                    // races the upgrade can still find and close the connection.
                    yield* bindRpcClientToSession(clientId, session.sessionId);
                    const isSessionActive = yield* isWebSocketSessionActive(session.sessionId);
                    if (!isSessionActive) {
                      yield* rpcWebSocketServer.closeClient(clientId, SESSION_REVOKED_CLOSE_EVENT);
                      return;
                    }
                    yield* sessionCredentials.markConnected(session.sessionId);
                  }),
                onClientDisconnected: (clientId) =>
                  Effect.gen(function* () {
                    yield* unbindRpcClient(clientId);
                    yield* Effect.orDie(sessionCredentials.markDisconnected(session.sessionId));
                  }),
              }),
            ),
          );
        }).pipe(
          Effect.catchTag("AuthError", (error) =>
            Effect.succeed(
              HttpServerResponse.text(error.message, {
                status: error.status ?? 401,
              }),
            ),
          ),
        ),
      );
    }),
  );
