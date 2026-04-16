import * as ChildProcess from "node:child_process";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import type { DesktopBenchmarkState } from "@t3tools/contracts";

export const REPO_ROOT = Path.resolve(import.meta.dir, "..");
export const DESKTOP_BENCHMARKS_ROOT = Path.join(REPO_ROOT, "artifacts", "desktop-benchmarks");
const BUN_BINARY = process.platform === "win32" ? "bun.exe" : "bun";
const WINDOWS_SHELL = "powershell.exe";

export type DesktopTarget = "electron" | "electrobun";

export interface DesktopTargetConfig {
  readonly target: DesktopTarget;
  readonly displayName: string;
  readonly startCwd: string;
  readonly startScript: string;
  readonly buildScript: string;
  readonly unpackedSizeDirCandidates: ReadonlyArray<string>;
  readonly artifactDirCandidates: ReadonlyArray<string>;
}

export interface LaunchDesktopTargetOptions {
  readonly target: DesktopTargetConfig;
  readonly profileDir: string;
  readonly outputPath: string;
  readonly scenario: string;
  readonly automationPickFolder?: string;
  readonly automationConfirmResponse?: "0" | "1";
  readonly disableExternalOpen?: boolean;
}

export interface WindowsProcessSnapshot {
  readonly rssBytes: number;
  readonly privateBytes: number;
  readonly cpu100ns: number;
  readonly processCount: number;
}

export interface DesktopLaunchHandle {
  readonly child: ChildProcess.ChildProcess;
  readonly launchedAt: string;
  readonly outputPath: string;
}

export const DESKTOP_TARGETS: Record<DesktopTarget, DesktopTargetConfig> = {
  electron: {
    target: "electron",
    displayName: "Electron",
    startCwd: Path.join(REPO_ROOT, "apps", "desktop"),
    startScript: "start",
    buildScript: "build:desktop",
    unpackedSizeDirCandidates: [Path.join(REPO_ROOT, "apps", "desktop", "dist-electron")],
    artifactDirCandidates: [Path.join(REPO_ROOT, "dist"), Path.join(REPO_ROOT, "release")],
  },
  electrobun: {
    target: "electrobun",
    displayName: "Electrobun",
    startCwd: Path.join(REPO_ROOT, "apps", "electrobun"),
    startScript: "start",
    buildScript: "build:electrobun",
    unpackedSizeDirCandidates: [
      Path.join(REPO_ROOT, "apps", "electrobun", ".electrobun"),
      Path.join(REPO_ROOT, "apps", "electrobun", "views"),
    ],
    artifactDirCandidates: [
      Path.join(REPO_ROOT, "apps", "electrobun", ".electrobun"),
      Path.join(REPO_ROOT, "release"),
    ],
  },
};

export function ensureWindowsHost(): void {
  if (process.platform !== "win32") {
    throw new Error(
      [
        "Desktop correctness and benchmark runs are Windows-host only in this repo right now.",
        `Current host: ${process.platform}`,
        "Run these scripts from Windows 11, not WSL.",
      ].join(" "),
    );
  }
}

export function createTimestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function ensureDir(dirPath: string): void {
  FS.mkdirSync(dirPath, { recursive: true });
}

export function removeDirIfExists(dirPath: string): void {
  FS.rmSync(dirPath, { recursive: true, force: true });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(FS.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeJsonFile(filePath: string, value: unknown): void {
  ensureDir(Path.dirname(filePath));
  FS.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function fileSizeBytes(filePath: string): number {
  return FS.statSync(filePath).size;
}

export function directorySizeBytes(dirPath: string): number {
  if (!FS.existsSync(dirPath)) {
    return 0;
  }

  const stack = [dirPath];
  let total = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of FS.readdirSync(current, { withFileTypes: true })) {
      const entryPath = Path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile()) {
        total += FS.statSync(entryPath).size;
      }
    }
  }
  return total;
}

function runPowerShellJson(script: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = ChildProcess.spawn(WINDOWS_SHELL, ["-NoProfile", "-Command", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `PowerShell exited with code ${code ?? "unknown"}`));
        return;
      }
      resolve(stdout.trim().length > 0 ? JSON.parse(stdout) : null);
    });
  });
}

export async function sampleWindowsProcessTree(pid: number): Promise<WindowsProcessSnapshot> {
  const script = `
$targetPid = ${pid};
$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, WorkingSetSize, PrivatePageCount, UserModeTime, KernelModeTime;
$pending = New-Object System.Collections.Generic.Queue[int];
$pending.Enqueue($targetPid);
$seen = New-Object System.Collections.Generic.HashSet[int];
$totals = [ordered]@{ rssBytes = 0; privateBytes = 0; cpu100ns = 0; processCount = 0 };
while ($pending.Count -gt 0) {
  $current = $pending.Dequeue();
  if (-not $seen.Add($current)) { continue }
  $matches = @($all | Where-Object { $_.ProcessId -eq $current });
  foreach ($match in $matches) {
    $totals.rssBytes += [int64]$match.WorkingSetSize;
    $totals.privateBytes += [int64]$match.PrivatePageCount;
    $totals.cpu100ns += ([int64]$match.UserModeTime + [int64]$match.KernelModeTime);
    $totals.processCount += 1;
  }
  $children = @($all | Where-Object { $_.ParentProcessId -eq $current });
  foreach ($child in $children) {
    $pending.Enqueue([int]$child.ProcessId);
  }
}
$totals | ConvertTo-Json -Compress
`;
  const result = (await runPowerShellJson(script)) as WindowsProcessSnapshot | null;
  if (!result) {
    return {
      rssBytes: 0,
      privateBytes: 0,
      cpu100ns: 0,
      processCount: 0,
    };
  }
  return result;
}

export async function sampleWindowsCpuPercent(
  pid: number,
  durationMs: number,
): Promise<{
  readonly cpuPercent: number;
  readonly before: WindowsProcessSnapshot;
  readonly after: WindowsProcessSnapshot;
}> {
  const before = await sampleWindowsProcessTree(pid);
  await sleep(durationMs);
  const after = await sampleWindowsProcessTree(pid);
  const cpuDelta100ns = Math.max(0, after.cpu100ns - before.cpu100ns);
  const elapsed100ns = durationMs * 10_000;
  const logicalCoreCount = Math.max(1, OS.availableParallelism());
  const cpuPercent =
    elapsed100ns === 0 ? 0 : (cpuDelta100ns / (elapsed100ns * logicalCoreCount)) * 100;
  return { cpuPercent, before, after };
}

export async function killWindowsProcessTree(pid: number | undefined): Promise<void> {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    const child = ChildProcess.spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
    child.once("error", () => resolve());
    child.once("exit", () => resolve());
  });
}

export async function waitForBenchmarkState(
  outputPath: string,
  predicate: (state: DesktopBenchmarkState) => boolean,
  timeoutMs: number,
): Promise<DesktopBenchmarkState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = readJsonFile<DesktopBenchmarkState>(outputPath);
    if (state && predicate(state)) {
      return state;
    }
    await sleep(250);
  }

  const currentState = readJsonFile<DesktopBenchmarkState>(outputPath);
  if (currentState) {
    throw new Error(
      `Timed out waiting for benchmark state condition. Last status=${currentState.status}`,
    );
  }
  throw new Error(`Timed out waiting for benchmark state file at ${outputPath}`);
}

export async function launchDesktopTarget(
  options: LaunchDesktopTargetOptions,
): Promise<DesktopLaunchHandle> {
  ensureDir(options.profileDir);
  ensureDir(Path.dirname(options.outputPath));
  FS.rmSync(options.outputPath, { force: true });

  const child = ChildProcess.spawn(BUN_BINARY, ["run", options.target.startScript], {
    cwd: options.target.startCwd,
    stdio: "ignore",
    env: {
      ...process.env,
      KODOCODE_HOME: options.profileDir,
      T3CODE_HOME: options.profileDir,
      KODOCODE_DESKTOP_BENCHMARK_RUN_ID: Path.basename(options.outputPath, ".json"),
      KODOCODE_DESKTOP_BENCHMARK_SCENARIO: options.scenario,
      KODOCODE_DESKTOP_BENCHMARK_OUTPUT_PATH: options.outputPath,
      KODOCODE_DESKTOP_AUTOMATION_PICK_FOLDER: options.automationPickFolder ?? REPO_ROOT,
      KODOCODE_DESKTOP_AUTOMATION_CONFIRM_RESPONSE: options.automationConfirmResponse ?? "1",
      KODOCODE_DESKTOP_AUTOMATION_DISABLE_EXTERNAL_OPEN:
        options.disableExternalOpen === false ? "0" : "1",
      VITE_DEV_SERVER_URL: "",
      ELECTRON_RENDERER_PORT: "",
      ELECTROBUN_RENDERER_PORT: "",
      PORT: "",
    },
  });

  return {
    child,
    launchedAt: new Date().toISOString(),
    outputPath: options.outputPath,
  };
}

export async function runBuildScript(scriptName: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = ChildProcess.spawn(BUN_BINARY, ["run", scriptName], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Build script '${scriptName}' exited with code ${code ?? "unknown"}`));
    });
  });
}

export function latestChildArtifactSizeBytes(paths: ReadonlyArray<string>): number | null {
  const candidates: Array<{
    readonly path: string;
    readonly mtimeMs: number;
    readonly sizeBytes: number;
  }> = [];
  for (const rootPath of paths) {
    if (!FS.existsSync(rootPath)) {
      continue;
    }

    const stack = [rootPath];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      for (const entry of FS.readdirSync(current, { withFileTypes: true })) {
        const entryPath = Path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(entryPath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        if (!/\.(exe|msi|zip|dmg|pkg|appimage|tar|gz|zst)$/i.test(entry.name)) {
          continue;
        }
        const stats = FS.statSync(entryPath);
        candidates.push({
          path: entryPath,
          mtimeMs: stats.mtimeMs,
          sizeBytes: stats.size,
        });
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.sizeBytes ?? null;
}

export function summarizeNumbers(values: ReadonlyArray<number>): {
  readonly count: number;
  readonly mean: number;
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly stdev: number;
} | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].toSorted((left, right) => left - right);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
      : sorted[Math.floor(sorted.length / 2)]!;
  const variance =
    sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, sorted.length - 1);
  return {
    count: sorted.length,
    mean,
    median,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    stdev: Math.sqrt(variance),
  };
}

export function millisecondsBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) {
    return null;
  }
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null;
  }
  return endMs - startMs;
}
