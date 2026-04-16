import * as Path from "node:path";

import {
  DESKTOP_BENCHMARKS_ROOT,
  DESKTOP_TARGETS,
  ensureDir,
  ensureWindowsHost,
  killWindowsProcessTree,
  launchDesktopTarget,
  waitForBenchmarkState,
  writeJsonFile,
  createTimestampSlug,
} from "./desktop-harness-lib.ts";

async function runCorrectnessTarget(targetKey: keyof typeof DESKTOP_TARGETS, outputDir: string) {
  const target = DESKTOP_TARGETS[targetKey];
  const profileDir = Path.join(outputDir, `${target.target}-profile`);
  const initialOutputPath = Path.join(outputDir, `${target.target}-correctness.json`);
  const verifyOutputPath = Path.join(outputDir, `${target.target}-persistence-verify.json`);

  const firstLaunch = await launchDesktopTarget({
    target,
    profileDir,
    outputPath: initialOutputPath,
    scenario: "correctness",
  });
  const correctnessState = await waitForBenchmarkState(
    initialOutputPath,
    (state) => state.completed,
    120_000,
  );
  await killWindowsProcessTree(firstLaunch.child.pid);

  const secondLaunch = await launchDesktopTarget({
    target,
    profileDir,
    outputPath: verifyOutputPath,
    scenario: "persistence-verify",
  });
  const persistenceState = await waitForBenchmarkState(
    verifyOutputPath,
    (state) => state.completed,
    120_000,
  );
  await killWindowsProcessTree(secondLaunch.child.pid);

  return {
    target: target.displayName,
    correctness: {
      success: correctnessState.success === true,
      state: correctnessState,
    },
    persistence: {
      success: persistenceState.success === true,
      state: persistenceState,
    },
  };
}

async function main() {
  ensureWindowsHost();

  const runDir = Path.join(DESKTOP_BENCHMARKS_ROOT, createTimestampSlug());
  ensureDir(runDir);

  const results = await Promise.all([
    runCorrectnessTarget("electron", runDir),
    runCorrectnessTarget("electrobun", runDir),
  ]);

  const summary = {
    generatedAt: new Date().toISOString(),
    results,
    success: results.every(
      (entry) => entry.correctness.success === true && entry.persistence.success === true,
    ),
  };

  writeJsonFile(Path.join(runDir, "correctness-summary.json"), summary);

  if (!summary.success) {
    throw new Error("Desktop correctness checks failed. See correctness-summary.json for details.");
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
