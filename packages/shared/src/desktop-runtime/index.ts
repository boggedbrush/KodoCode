import type {
  DesktopBenchmarkMilestone,
  DesktopBenchmarkState,
  DesktopBridgeBootstrap,
  DesktopCapabilities,
  DesktopRuntime,
  DesktopStartupMilestones,
} from "@t3tools/contracts";

export const DESKTOP_BENCHMARK_MILESTONES = [
  "processSpawned",
  "firstWindowCreated",
  "firstWindowShown",
  "rendererBootstrap",
  "rendererReady",
  "backendConnected",
] as const satisfies ReadonlyArray<DesktopBenchmarkMilestone>;

export function createDesktopCapabilities(
  partial: Partial<DesktopCapabilities> = {},
): DesktopCapabilities {
  return {
    updates: false,
    applicationMenu: false,
    nativeContextMenu: false,
    windowControls: false,
    benchmarkDriver: false,
    ...partial,
  };
}

export function createDesktopStartupMilestones(
  partial: Partial<DesktopStartupMilestones> = {},
): DesktopStartupMilestones {
  return {
    processSpawnedAt: null,
    firstWindowCreatedAt: null,
    firstWindowShownAt: null,
    rendererBootstrapAt: null,
    rendererReadyAt: null,
    backendConnectedAt: null,
    ...partial,
  };
}

export function createDesktopBridgeBootstrap(input: {
  runtime: DesktopRuntime;
  wsUrl: string | null;
  capabilities?: Partial<DesktopCapabilities>;
  startup?: Partial<DesktopStartupMilestones>;
}): DesktopBridgeBootstrap {
  return {
    runtime: input.runtime,
    capabilities: createDesktopCapabilities(input.capabilities),
    connection: {
      wsUrl: input.wsUrl,
    },
    startup: createDesktopStartupMilestones(input.startup),
  };
}

export function markDesktopBenchmarkMilestone(
  state: DesktopStartupMilestones,
  milestone: DesktopBenchmarkMilestone,
  at: string,
): DesktopStartupMilestones {
  switch (milestone) {
    case "processSpawned":
      return { ...state, processSpawnedAt: state.processSpawnedAt ?? at };
    case "firstWindowCreated":
      return { ...state, firstWindowCreatedAt: state.firstWindowCreatedAt ?? at };
    case "firstWindowShown":
      return { ...state, firstWindowShownAt: state.firstWindowShownAt ?? at };
    case "rendererBootstrap":
      return { ...state, rendererBootstrapAt: state.rendererBootstrapAt ?? at };
    case "rendererReady":
      return { ...state, rendererReadyAt: state.rendererReadyAt ?? at };
    case "backendConnected":
      return { ...state, backendConnectedAt: state.backendConnectedAt ?? at };
  }
}

export function createDesktopBenchmarkState(input: {
  enabled: boolean;
  runtime: DesktopRuntime;
  runId?: string | null;
  scenario?: string | null;
  outputPath?: string | null;
  startedAt?: string | null;
  startup?: Partial<DesktopStartupMilestones>;
}): DesktopBenchmarkState {
  return {
    enabled: input.enabled,
    runtime: input.runtime,
    runId: input.runId ?? null,
    scenario: input.scenario ?? null,
    outputPath: input.outputPath ?? null,
    status: input.enabled ? "running" : "idle",
    startedAt: input.startedAt ?? null,
    completedAt: null,
    completed: false,
    success: null,
    lastError: null,
    milestones: createDesktopStartupMilestones(input.startup),
    events: [],
  };
}
