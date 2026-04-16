import * as OS from "node:os";
import * as Path from "node:path";

import {
  DESKTOP_BENCHMARKS_ROOT,
  DESKTOP_TARGETS,
  createTimestampSlug,
  directorySizeBytes,
  ensureDir,
  ensureWindowsHost,
  killWindowsProcessTree,
  launchDesktopTarget,
  latestChildArtifactSizeBytes,
  millisecondsBetween,
  runBuildScript,
  sampleWindowsCpuPercent,
  sampleWindowsProcessTree,
  sleep,
  summarizeNumbers,
  waitForBenchmarkState,
  writeJsonFile,
} from "./desktop-harness-lib.ts";
import type { DesktopBenchmarkState } from "@t3tools/contracts";

const COLD_ITERATIONS = 10;
const WARM_ITERATIONS = 10;
const STARTUP_TIMEOUT_MS = 120_000;
const INTERACTION_TIMEOUT_MS = 180_000;
const IDLE_SAMPLE_DURATION_MS = 60_000;

interface StartupIterationResult {
  readonly success: boolean;
  readonly error: string | null;
  readonly firstWindowShownMs: number | null;
  readonly rendererReadyMs: number | null;
  readonly backendConnectedMs: number | null;
  readonly rssBytesAfterLaunch: number | null;
  readonly privateBytesAfterLaunch: number | null;
}

async function runStartupIteration(input: {
  readonly targetKey: keyof typeof DESKTOP_TARGETS;
  readonly outputDir: string;
  readonly profileDir: string;
  readonly scenario: string;
  readonly runLabel: string;
}): Promise<StartupIterationResult> {
  const target = DESKTOP_TARGETS[input.targetKey];
  const outputPath = Path.join(input.outputDir, `${input.runLabel}.json`);
  const launchHandle = await launchDesktopTarget({
    target,
    profileDir: input.profileDir,
    outputPath,
    scenario: input.scenario,
  });

  try {
    const state = await waitForBenchmarkState(
      outputPath,
      (value) => value.completed,
      STARTUP_TIMEOUT_MS,
    );
    const metrics = await sampleWindowsProcessTree(launchHandle.child.pid ?? 0);
    return {
      success: state.success === true,
      error: state.success === true ? null : state.lastError,
      firstWindowShownMs: millisecondsBetween(state.startedAt, state.milestones.firstWindowShownAt),
      rendererReadyMs: millisecondsBetween(state.startedAt, state.milestones.rendererReadyAt),
      backendConnectedMs: millisecondsBetween(state.startedAt, state.milestones.backendConnectedAt),
      rssBytesAfterLaunch: metrics.rssBytes,
      privateBytesAfterLaunch: metrics.privateBytes,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      firstWindowShownMs: null,
      rendererReadyMs: null,
      backendConnectedMs: null,
      rssBytesAfterLaunch: null,
      privateBytesAfterLaunch: null,
    };
  } finally {
    await killWindowsProcessTree(launchHandle.child.pid);
  }
}

async function runIdleProbe(
  targetKey: keyof typeof DESKTOP_TARGETS,
  outputDir: string,
  profileDir: string,
): Promise<{
  readonly state: DesktopBenchmarkState;
  readonly launchMemory: Awaited<ReturnType<typeof sampleWindowsProcessTree>>;
  readonly idleMemory: Awaited<ReturnType<typeof sampleWindowsProcessTree>>;
  readonly idleCpuPercent: number;
}> {
  const target = DESKTOP_TARGETS[targetKey];
  const outputPath = Path.join(outputDir, `${target.target}-idle.json`);
  const launchHandle = await launchDesktopTarget({
    target,
    profileDir,
    outputPath,
    scenario: "startup",
  });

  try {
    const state = await waitForBenchmarkState(
      outputPath,
      (value) => value.completed,
      STARTUP_TIMEOUT_MS,
    );
    const launchMemory = await sampleWindowsProcessTree(launchHandle.child.pid ?? 0);
    const cpuSample = await sampleWindowsCpuPercent(
      launchHandle.child.pid ?? 0,
      IDLE_SAMPLE_DURATION_MS,
    );
    const idleMemory = await sampleWindowsProcessTree(launchHandle.child.pid ?? 0);
    return {
      state,
      launchMemory,
      idleMemory,
      idleCpuPercent: cpuSample.cpuPercent,
    };
  } finally {
    await killWindowsProcessTree(launchHandle.child.pid);
  }
}

async function runInteractionProbe(
  targetKey: keyof typeof DESKTOP_TARGETS,
  outputDir: string,
  profileDir: string,
): Promise<{
  readonly state: DesktopBenchmarkState;
  readonly peakRssBytes: number;
  readonly peakPrivateBytes: number;
  readonly averageCpuPercent: number;
  readonly interactionDurationMs: number | null;
}> {
  const target = DESKTOP_TARGETS[targetKey];
  const outputPath = Path.join(outputDir, `${target.target}-interaction.json`);
  const launchHandle = await launchDesktopTarget({
    target,
    profileDir,
    outputPath,
    scenario: "interaction",
  });

  let peakRssBytes = 0;
  let peakPrivateBytes = 0;
  let pollerStopped = false;
  const poller = (async () => {
    while (true) {
      if (pollerStopped) {
        break;
      }
      const sample = await sampleWindowsProcessTree(launchHandle.child.pid ?? 0);
      peakRssBytes = Math.max(peakRssBytes, sample.rssBytes);
      peakPrivateBytes = Math.max(peakPrivateBytes, sample.privateBytes);
      await sleep(1_000);
    }
  })();

  try {
    const before = await sampleWindowsProcessTree(launchHandle.child.pid ?? 0);
    const state = await waitForBenchmarkState(
      outputPath,
      (value) => value.completed,
      INTERACTION_TIMEOUT_MS,
    );
    const after = await sampleWindowsProcessTree(launchHandle.child.pid ?? 0);
    const cpuDelta100ns = Math.max(0, after.cpu100ns - before.cpu100ns);
    const interactionDurationMs =
      millisecondsBetween(state.milestones.rendererReadyAt, state.completedAt) ??
      millisecondsBetween(state.startedAt, state.completedAt);
    const cpuPercent =
      interactionDurationMs && interactionDurationMs > 0
        ? (cpuDelta100ns /
            (interactionDurationMs * 10_000 * Math.max(1, OS.availableParallelism()))) *
          100
        : 0;
    return {
      state,
      peakRssBytes,
      peakPrivateBytes,
      averageCpuPercent: cpuPercent,
      interactionDurationMs,
    };
  } finally {
    pollerStopped = true;
    await poller.catch(() => undefined);
    await killWindowsProcessTree(launchHandle.child.pid);
  }
}

async function benchmarkTarget(targetKey: keyof typeof DESKTOP_TARGETS, runDir: string) {
  const target = DESKTOP_TARGETS[targetKey];
  const outputDir = Path.join(runDir, target.target);
  ensureDir(outputDir);

  const coldResults: StartupIterationResult[] = [];
  for (let index = 0; index < COLD_ITERATIONS; index += 1) {
    const profileDir = Path.join(outputDir, `cold-profile-${index + 1}`);
    coldResults.push(
      await runStartupIteration({
        targetKey,
        outputDir,
        profileDir,
        scenario: "startup",
        runLabel: `${target.target}-cold-${index + 1}`,
      }),
    );
  }

  const warmProfileDir = Path.join(outputDir, "warm-profile");
  await runStartupIteration({
    targetKey,
    outputDir,
    profileDir: warmProfileDir,
    scenario: "startup",
    runLabel: `${target.target}-warm-prime`,
  });

  const warmResults: StartupIterationResult[] = [];
  for (let index = 0; index < WARM_ITERATIONS; index += 1) {
    warmResults.push(
      await runStartupIteration({
        targetKey,
        outputDir,
        profileDir: warmProfileDir,
        scenario: "startup",
        runLabel: `${target.target}-warm-${index + 1}`,
      }),
    );
  }

  const idleProbe = await runIdleProbe(targetKey, outputDir, Path.join(outputDir, "idle-profile"));
  const interactionProbe = await runInteractionProbe(
    targetKey,
    outputDir,
    Path.join(outputDir, "interaction-profile"),
  );

  const shippedArtifactSizeBytes = latestChildArtifactSizeBytes(target.artifactDirCandidates);
  const unpackedAppSizeBytes = target.unpackedSizeDirCandidates.reduce(
    (total, candidate) => total + directorySizeBytes(candidate),
    0,
  );

  const summary = {
    target: target.displayName,
    coldStart: {
      firstWindowShownMs: summarizeNumbers(
        coldResults.flatMap((entry) =>
          entry.firstWindowShownMs === null ? [] : [entry.firstWindowShownMs],
        ),
      ),
      rendererReadyMs: summarizeNumbers(
        coldResults.flatMap((entry) =>
          entry.rendererReadyMs === null ? [] : [entry.rendererReadyMs],
        ),
      ),
      backendConnectedMs: summarizeNumbers(
        coldResults.flatMap((entry) =>
          entry.backendConnectedMs === null ? [] : [entry.backendConnectedMs],
        ),
      ),
      failures: coldResults.filter((entry) => !entry.success).map((entry) => entry.error),
      iterations: coldResults,
    },
    warmStart: {
      firstWindowShownMs: summarizeNumbers(
        warmResults.flatMap((entry) =>
          entry.firstWindowShownMs === null ? [] : [entry.firstWindowShownMs],
        ),
      ),
      rendererReadyMs: summarizeNumbers(
        warmResults.flatMap((entry) =>
          entry.rendererReadyMs === null ? [] : [entry.rendererReadyMs],
        ),
      ),
      backendConnectedMs: summarizeNumbers(
        warmResults.flatMap((entry) =>
          entry.backendConnectedMs === null ? [] : [entry.backendConnectedMs],
        ),
      ),
      failures: warmResults.filter((entry) => !entry.success).map((entry) => entry.error),
      iterations: warmResults,
    },
    idle: {
      rssBytesAfterLaunch: idleProbe.launchMemory.rssBytes,
      privateBytesAfterLaunch: idleProbe.launchMemory.privateBytes,
      rssBytesAfterOneMinute: idleProbe.idleMemory.rssBytes,
      privateBytesAfterOneMinute: idleProbe.idleMemory.privateBytes,
      cpuPercentAfterOneMinute: idleProbe.idleCpuPercent,
    },
    interaction: {
      success: interactionProbe.state.success === true,
      lastError: interactionProbe.state.lastError,
      peakRssBytes: interactionProbe.peakRssBytes,
      peakPrivateBytes: interactionProbe.peakPrivateBytes,
      averageCpuPercent: interactionProbe.averageCpuPercent,
      interactionDurationMs: interactionProbe.interactionDurationMs,
      events: interactionProbe.state.events,
    },
    artifactSizes: {
      shippedArtifactSizeBytes,
      unpackedAppSizeBytes,
    },
  };

  writeJsonFile(Path.join(outputDir, "summary.json"), summary);
  return summary;
}

async function main() {
  ensureWindowsHost();

  const runDir = Path.join(DESKTOP_BENCHMARKS_ROOT, createTimestampSlug());
  ensureDir(runDir);

  await runBuildScript("build:desktop");
  await runBuildScript("build:electrobun");

  const environment = {
    generatedAt: new Date().toISOString(),
    host: {
      platform: process.platform,
      release: OS.release(),
      arch: process.arch,
      logicalCpuCount: OS.availableParallelism(),
      totalMemoryBytes: OS.totalmem(),
    },
    bunVersion: Bun.version,
    nodeVersion: process.version,
  };
  writeJsonFile(Path.join(runDir, "environment.json"), environment);

  const electronSummary = await benchmarkTarget("electron", runDir);
  const electrobunSummary = await benchmarkTarget("electrobun", runDir);
  const combined = {
    environment,
    results: {
      electron: electronSummary,
      electrobun: electrobunSummary,
    },
  };
  writeJsonFile(Path.join(runDir, "summary.json"), combined);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
