// KODO: swarm-guard - the Orchestrator's tool allowlist, at the tool door, over every tool the server
// really registers (not a list kept here), whatever a tool's failure type or arguments are.
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  KODO_ORCHESTRATOR_THREAD_ID,
  kodoOrchestratorThreadIdFor,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { McpProviderSessions } from "@t3tools/provider-core/server/McpProviderSessions";
import { KODO_ORCHESTRATOR_PROJECT_ID } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";

import { AssetSigner } from "../assets/AssetSigner.ts";
import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import { ServerConfig } from "../config.ts";
import { DeviceService } from "../device/DeviceService.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { KODO_ORCHESTRATOR_TOOLS } from "../kodo/swarm/swarmAllowlist.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ProviderAdapterRegistryV2 } from "../orchestration-v2/ProviderAdapterRegistry.ts";
import { ThreadLaunchService } from "../orchestration-v2/ThreadLaunchService.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { ThreadSearch } from "../orchestration-v2/ThreadSearch.ts";
import { PeerForwarding } from "../peer/PeerForwarding.ts";
import { PeerLinkRequests } from "../peer/PeerLinkRequests.ts";
import { PeerLinks } from "../peer/PeerLinks.ts";
import { RemoteDelegation } from "../peer/RemoteDelegation.ts";
import { PreviewManager } from "../preview/Manager.ts";
import { PreviewBrowser } from "../preview/PreviewBrowser.ts";
import { ManagedProjectFolders } from "../project/ManagedProjectFolders.ts";
import { ProjectCloneTracker } from "../project/ProjectCloneTracker.ts";
import { ProjectService } from "../project/ProjectService.ts";
import { ProjectSetupScriptRunner } from "../project/ProjectSetupScriptRunner.ts";
import { DocumentText } from "../provider/DocumentText.ts";
import { ProviderRegistry } from "../provider/ProviderRegistry.ts";
import { PullRequestReviewGuideService } from "../pullRequest/PullRequestReviewGuideService.ts";
import { ScheduledTaskService } from "../scheduledTasks/ScheduledTaskService.ts";
import { SecretRequests } from "../secrets/SecretRequests.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { SourceControlRepositoryService } from "../sourceControl/SourceControlRepositoryService.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import { VcsStatusBroadcaster } from "../vcs/VcsStatusBroadcaster.ts";
import { type McpInvocationScope, McpInvocationContext } from "./McpInvocationContext.ts";
import * as McpHttpServer from "./McpHttpServer.ts";
import { PreviewAutomationBroker } from "./PreviewAutomationBroker.ts";
import { liveThreadShell } from "./McpToolAccess.testkit.ts";

// Registration only stores tool definitions, so the handlers' services are never really used: a
// call that gets past the guard fails on these mocks instead of doing anything.
const handlerServices = (
  mocks: {
    readonly project?: Partial<ProjectService["Service"]>;
    readonly threads?: Partial<ThreadManagementService["Service"]>;
    readonly search?: Partial<ThreadSearch["Service"]>;
  } = {},
) =>
  Layer.mergeAll(
    Layer.mock(AssetSigner)({}),
    Layer.mock(DeviceService)({}),
    Layer.mock(DocumentText)({}),
    Layer.mock(GitVcsDriver)({}),
    Layer.mock(GitWorkflowService)({}),
    Layer.mock(ManagedProjectFolders)({ namedProjectsRoot: "" }),
    Layer.mock(McpProviderSessions)({}),
    Layer.mock(OrchestratorV2)({}),
    Layer.mock(PeerForwarding)({}),
    Layer.mock(PeerLinkRequests)({}),
    Layer.mock(PeerLinks)({}),
    Layer.mock(PreviewAutomationBroker)({}),
    Layer.mock(PreviewBrowser)({}),
    Layer.mock(PreviewManager)({}),
    Layer.mock(ProjectCloneTracker)({}),
    Layer.mock(ProjectService)(mocks.project ?? {}),
    Layer.mock(ProjectSetupScriptRunner)({}),
    Layer.mock(ProviderAdapterRegistryV2)({}),
    Layer.mock(ProviderRegistry)({}),
    Layer.mock(PullRequestReviewGuideService)({}),
    Layer.mock(RemoteDelegation)({}),
    Layer.mock(ScheduledTaskService)({}),
    Layer.mock(SecretRequests)({}),
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-swarm-guard-" }),
    Layer.mock(ServerEnvironment)({}),
    Layer.mock(ServerSecretStore)({}),
    Layer.mock(ServerSettingsService)({}),
    Layer.mock(SourceControlRepositoryService)({}),
    Layer.mock(ThreadLaunchService)({}),
    Layer.mock(ThreadManagementService)(mocks.threads ?? {}),
    Layer.mock(ThreadSearch)(mocks.search ?? {}),
    Layer.mock(VcsStatusBroadcaster)({}),
  ).pipe(Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

const layerRealTools = McpHttpServer.layerTools.pipe(
  Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
  Layer.provide(handlerServices()),
);

const mcpClient = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "swarm-guard-test", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "swarm-guard-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});

const scope = (input: {
  readonly threadId: string;
  readonly kodoSwarm?: boolean;
}): McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment"),
  requestNamespace: "provider:thread",
  thread: {
    threadId: ThreadId.make(input.threadId),
    providerSessionId: "provider:thread",
    providerInstanceId: ProviderInstanceId.make("codex"),
    ...(input.kodoSwarm === true ? { kodoSwarm: true } : {}),
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
});

const REFUSAL = "is not available to the Orchestrator";

/** Whether the call came back refused by the Orchestrator's allowlist, as opposed to anything else it did. */
const refused = (
  server: McpServer.McpServer["Service"],
  name: string,
  caller: McpInvocationScope,
) =>
  server.callTool({ name, arguments: {} }).pipe(
    Effect.provideService(McpInvocationContext, caller),
    Effect.provideService(McpSchema.McpServerClient, mcpClient),
    Effect.exit,
    Effect.map(
      (exit) =>
        Exit.isSuccess(exit) &&
        exit.value.isError === true &&
        JSON.stringify(exit.value.content).includes(REFUSAL),
    ),
  );

it.effect(
  "refuses every real registered tool that is not on the allowlist, whatever its failure type, for the Orchestrator",
  () =>
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const names = server.tools.map(({ tool }) => tool.name);
      // A guard that covered a stub of the server would pass on an empty list.
      expect(names.length).toBeGreaterThan(40);
      const swarm = scope({ threadId: "any-thread", kodoSwarm: true });
      const verdicts = yield* Effect.forEach(names, (name) =>
        refused(server, name, swarm).pipe(Effect.map((isRefused) => [name, isRefused] as const)),
      );
      const wronglyPassed = verdicts
        .filter(([name, isRefused]) => !KODO_ORCHESTRATOR_TOOLS.has(name) && !isRefused)
        .map(([name]) => name);
      expect(wronglyPassed).toEqual([]);
      const wronglyRefused = verdicts
        .filter(([name, isRefused]) => KODO_ORCHESTRATOR_TOOLS.has(name) && isRefused)
        .map(([name]) => name);
      expect(wronglyRefused).toEqual([]);
    }).pipe(Effect.provide(layerRealTools)),
);

it.effect(
  "names only tools that exist, and refuses by the fixed id when the credential is unmarked",
  () =>
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const names = new Set(server.tools.map(({ tool }) => tool.name));
      for (const listed of KODO_ORCHESTRATOR_TOOLS) expect(names.has(listed), listed).toBe(true);
      // A credential that lost its mark (a failed read when it was issued) still cannot reach a tool.
      const unmarked = scope({ threadId: KODO_ORCHESTRATOR_THREAD_ID });
      expect(yield* refused(server, "t3_thread_send", unmarked)).toBe(true);
      expect(yield* refused(server, "preview_open", unmarked)).toBe(true);
    }).pipe(Effect.provide(layerRealTools)),
);

it.effect("leaves every other thread's tools alone", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const ordinary = scope({ threadId: "an-ordinary-thread" });
    const verdicts = yield* Effect.forEach(
      server.tools.map(({ tool }) => tool.name),
      (name) => refused(server, name, ordinary),
    );
    expect(verdicts.some(Boolean)).toBe(false);
  }).pipe(Effect.provide(layerRealTools)),
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

// What other agents see of the Orchestrator through the T3 tools: not its project, not its conversation.
const projectRecord = (id: string, title: string) => ({
  id,
  title,
  workspaceRoot: `/work/${id}`,
  repositoryIdentity: null,
  faviconPath: null,
  defaultModelSelection: null,
  defaultThreadEnvMode: null,
  autoPull: false,
  projectIcon: null,
  scripts: [],
  pinnedAt: null,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
});
const ordinaryProject = projectRecord("project:ordinary", "Ordinary");
const scratchProject = projectRecord(KODO_ORCHESTRATOR_PROJECT_ID, "Orchestrator");
const ordinaryThread = ThreadId.make("thread:ordinary");
const shellOf = (id: ThreadId) => ({
  ...liveThreadShell(id),
  deletedAt: null,
  archivedAt: null,
  createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
  updatedAt: DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
});
const layerSeeingOrchestrator = McpHttpServer.layerTools.pipe(
  Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
  Layer.provide(
    handlerServices({
      project: {
        listPage: () =>
          Effect.succeed({
            projects: [ordinaryProject, scratchProject],
            nextCursor: null,
          } as never),
        getById: (id) =>
          Effect.succeedSome(
            [ordinaryProject, scratchProject].find((project) => project.id === id) as never,
          ),
      },
      threads: {
        getThreadShell: (id) => Effect.succeed(shellOf(id) as never),
        getThreadRecords: (id) => Effect.succeed({ thread: shellOf(id), runs: [] } as never),
        listProjectThreads: () =>
          Effect.succeed([
            shellOf(ordinaryThread),
            shellOf(KODO_ORCHESTRATOR_THREAD_ID),
            shellOf(kodoOrchestratorThreadIdFor(2)),
          ] as never),
      },
      search: {
        searchThreads: () =>
          Effect.succeed({
            matches: [ordinaryThread, KODO_ORCHESTRATOR_THREAD_ID].map((threadId) => ({
              threadId,
              projectId: "project:x",
              title: threadId,
              source: "title",
            })),
          } as never),
      },
    }),
  ),
);

const seen = (server: McpServer.McpServer["Service"], tool: string, caller: McpInvocationScope) =>
  server
    .callTool({ name: tool, arguments: tool === "t3_thread_search" ? { query: "ordinary" } : {} })
    .pipe(
      Effect.provideService(McpInvocationContext, caller),
      Effect.provideService(McpSchema.McpServerClient, mcpClient),
      Effect.orDie,
      Effect.map((result) => JSON.stringify(result)),
    );

it.effect(
  "keeps its project and conversation out of other agents' lists and search, and shows them to itself",
  () =>
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const other = scope({ threadId: "thread:ordinary" });
      const itself = scope({ threadId: KODO_ORCHESTRATOR_THREAD_ID, kodoSwarm: true });
      for (const [tool, hidden] of [
        ["t3_project_list", KODO_ORCHESTRATOR_PROJECT_ID],
        ["t3_thread_list", KODO_ORCHESTRATOR_THREAD_ID],
        ["t3_thread_list", kodoOrchestratorThreadIdFor(2)],
        ["t3_thread_search", KODO_ORCHESTRATOR_THREAD_ID],
      ] as const) {
        expect(yield* seen(server, tool, other), `${tool} for another agent`).not.toContain(
          `"${hidden}"`,
        );
        expect(yield* seen(server, tool, itself), `${tool} for itself`).toContain(`"${hidden}"`);
      }
      // The ordinary ones are listed for both: only the Orchestrator's own are withheld.
      expect(yield* seen(server, "t3_project_list", other)).toContain("project:ordinary");
      expect(yield* seen(server, "t3_thread_list", other)).toContain(ordinaryThread);
      expect(yield* seen(server, "t3_thread_search", other)).toContain(ordinaryThread);
    }).pipe(Effect.provide(layerSeeingOrchestrator)),
);
