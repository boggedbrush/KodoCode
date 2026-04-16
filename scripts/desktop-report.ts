import * as FS from "node:fs";
import * as Path from "node:path";

import { DESKTOP_BENCHMARKS_ROOT } from "./desktop-harness-lib.ts";

function latestRunDir(): string | null {
  if (!FS.existsSync(DESKTOP_BENCHMARKS_ROOT)) {
    return null;
  }
  const entries = FS.readdirSync(DESKTOP_BENCHMARKS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted()
    .toReversed();
  const latest = entries[0];
  return latest ? Path.join(DESKTOP_BENCHMARKS_ROOT, latest) : null;
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(FS.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) {
    return "n/a";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function formatMs(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return "n/a";
  }
  return `${value.toFixed(2)} ms`;
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return "n/a";
  }
  return `${value.toFixed(2)}%`;
}

function nestedNumber(
  value: Record<string, unknown>,
  first: string,
  second?: string,
  third?: string,
): number | null {
  const firstValue = value[first];
  if (typeof firstValue !== "object" || firstValue === null) {
    return null;
  }
  if (!second) {
    return typeof firstValue === "number" ? firstValue : null;
  }
  const secondValue = (firstValue as Record<string, unknown>)[second];
  if (third === undefined) {
    return typeof secondValue === "number" ? secondValue : null;
  }
  if (typeof secondValue !== "object" || secondValue === null) {
    return null;
  }
  const thirdValue = (secondValue as Record<string, unknown>)[third];
  return typeof thirdValue === "number" ? thirdValue : null;
}

async function main() {
  const runDir = latestRunDir();
  const outputPath = Path.join(process.cwd(), "docs", "desktop-benchmark-report.md");

  if (!runDir) {
    FS.writeFileSync(
      outputPath,
      [
        "# Desktop Benchmark Report",
        "",
        "No benchmark results are available yet.",
        "",
        "Run `bun run benchmark:desktop` from a Windows 11 host to generate measurements.",
        "",
      ].join("\n"),
      "utf8",
    );
    return;
  }

  const summary = readJson<Record<string, unknown>>(Path.join(runDir, "summary.json"));
  if (!summary) {
    throw new Error(`Unable to read benchmark summary from ${runDir}`);
  }

  const electron = ((summary.results as Record<string, unknown>).electron ?? {}) as Record<
    string,
    unknown
  >;
  const electrobun = ((summary.results as Record<string, unknown>).electrobun ?? {}) as Record<
    string,
    unknown
  >;
  const environment = (summary.environment ?? {}) as Record<string, unknown>;
  const host = (environment.host ?? {}) as Record<string, unknown>;
  const electronColdFirstWindow = nestedNumber(
    electron,
    "coldStart",
    "firstWindowShownMs",
    "median",
  );
  const electrobunColdFirstWindow = nestedNumber(
    electrobun,
    "coldStart",
    "firstWindowShownMs",
    "median",
  );
  const electronColdRendererReady = nestedNumber(
    electron,
    "coldStart",
    "rendererReadyMs",
    "median",
  );
  const electrobunColdRendererReady = nestedNumber(
    electrobun,
    "coldStart",
    "rendererReadyMs",
    "median",
  );
  const electronWarmFirstWindow = nestedNumber(
    electron,
    "warmStart",
    "firstWindowShownMs",
    "median",
  );
  const electrobunWarmFirstWindow = nestedNumber(
    electrobun,
    "warmStart",
    "firstWindowShownMs",
    "median",
  );
  const electronWarmRendererReady = nestedNumber(
    electron,
    "warmStart",
    "rendererReadyMs",
    "median",
  );
  const electrobunWarmRendererReady = nestedNumber(
    electrobun,
    "warmStart",
    "rendererReadyMs",
    "median",
  );
  const electronIdleRss = nestedNumber(electron, "idle", "rssBytesAfterOneMinute");
  const electrobunIdleRss = nestedNumber(electrobun, "idle", "rssBytesAfterOneMinute");
  const electronIdlePrivate = nestedNumber(electron, "idle", "privateBytesAfterOneMinute");
  const electrobunIdlePrivate = nestedNumber(electrobun, "idle", "privateBytesAfterOneMinute");
  const electronIdleCpu = nestedNumber(electron, "idle", "cpuPercentAfterOneMinute");
  const electrobunIdleCpu = nestedNumber(electrobun, "idle", "cpuPercentAfterOneMinute");
  const electronInteractionDuration = nestedNumber(
    electron,
    "interaction",
    "interactionDurationMs",
  );
  const electrobunInteractionDuration = nestedNumber(
    electrobun,
    "interaction",
    "interactionDurationMs",
  );
  const electronInteractionPeakRss = nestedNumber(electron, "interaction", "peakRssBytes");
  const electrobunInteractionPeakRss = nestedNumber(electrobun, "interaction", "peakRssBytes");
  const electronInteractionPeakPrivate = nestedNumber(electron, "interaction", "peakPrivateBytes");
  const electrobunInteractionPeakPrivate = nestedNumber(
    electrobun,
    "interaction",
    "peakPrivateBytes",
  );
  const electronInteractionCpu = nestedNumber(electron, "interaction", "averageCpuPercent");
  const electrobunInteractionCpu = nestedNumber(electrobun, "interaction", "averageCpuPercent");
  const electronShippedArtifact = nestedNumber(
    electron,
    "artifactSizes",
    "shippedArtifactSizeBytes",
  );
  const electrobunShippedArtifact = nestedNumber(
    electrobun,
    "artifactSizes",
    "shippedArtifactSizeBytes",
  );
  const electronUnpackedSize = nestedNumber(electron, "artifactSizes", "unpackedAppSizeBytes");
  const electrobunUnpackedSize = nestedNumber(electrobun, "artifactSizes", "unpackedAppSizeBytes");

  const report = [
    "# Desktop Benchmark Report",
    "",
    `Source run: \`${runDir}\``,
    "",
    "## Environment",
    "",
    `- Generated: ${String(environment.generatedAt ?? "n/a")}`,
    `- Platform: ${String(host.platform ?? "n/a")} ${String(host.release ?? "")}`.trimEnd(),
    `- Architecture: ${String(host.arch ?? "n/a")}`,
    `- Logical CPU count: ${String(host.logicalCpuCount ?? "n/a")}`,
    `- Total memory: ${formatBytes(typeof host.totalMemoryBytes === "number" ? host.totalMemoryBytes : null)}`,
    `- Bun version: ${String(environment.bunVersion ?? "n/a")}`,
    `- Node version: ${String(environment.nodeVersion ?? "n/a")}`,
    "",
    "## Methodology",
    "",
    "- Startup milestones come from shell and renderer timestamps written to benchmark state files.",
    "- Cold and warm startup each run 10 iterations per target.",
    "- Memory and CPU are sampled from the Windows process tree for each launched target.",
    "- Interaction runs use the same renderer-side scripted flow for both targets.",
    "- Shipped artifact size is reported only when a packaged artifact was found in build output directories.",
    "- These measurements are intended to run on the Windows host, not inside WSL.",
    "",
    "## Summary Comparison",
    "",
    "| Metric | Electron | Electrobun |",
    "| --- | --- | --- |",
    `| Cold start to first window (median) | ${formatMs(electronColdFirstWindow)} | ${formatMs(electrobunColdFirstWindow)} |`,
    `| Cold start to renderer ready (median) | ${formatMs(electronColdRendererReady)} | ${formatMs(electrobunColdRendererReady)} |`,
    `| Warm start to first window (median) | ${formatMs(electronWarmFirstWindow)} | ${formatMs(electrobunWarmFirstWindow)} |`,
    `| Warm start to renderer ready (median) | ${formatMs(electronWarmRendererReady)} | ${formatMs(electrobunWarmRendererReady)} |`,
    `| Idle RSS after 1 minute | ${formatBytes(electronIdleRss)} | ${formatBytes(electrobunIdleRss)} |`,
    `| Idle private memory after 1 minute | ${formatBytes(electronIdlePrivate)} | ${formatBytes(electrobunIdlePrivate)} |`,
    `| Idle CPU after 1 minute | ${formatPercent(electronIdleCpu)} | ${formatPercent(electrobunIdleCpu)} |`,
    `| Interaction duration | ${formatMs(electronInteractionDuration)} | ${formatMs(electrobunInteractionDuration)} |`,
    `| Peak RSS during interaction | ${formatBytes(electronInteractionPeakRss)} | ${formatBytes(electrobunInteractionPeakRss)} |`,
    `| Peak private memory during interaction | ${formatBytes(electronInteractionPeakPrivate)} | ${formatBytes(electrobunInteractionPeakPrivate)} |`,
    `| Average CPU during interaction | ${formatPercent(electronInteractionCpu)} | ${formatPercent(electrobunInteractionCpu)} |`,
    `| Shipped artifact size | ${formatBytes(electronShippedArtifact)} | ${formatBytes(electrobunShippedArtifact)} |`,
    `| Unpacked app size | ${formatBytes(electronUnpackedSize)} | ${formatBytes(electrobunUnpackedSize)} |`,
    "",
    "## Migration Findings",
    "",
    "- Electron remains the baseline/default desktop path in this repo.",
    "- Electrobun is implemented as an experimental shell target with the same renderer flow and benchmark driver contract.",
    "- Electrobun updater parity is intentionally disabled and reported as unsupported.",
    "- Linux application-menu parity remains limited under Electrobun.",
    "",
    "## Stability Findings",
    "",
    "- Review the raw `success`, `lastError`, and failure arrays in the JSON artifacts under the linked run directory.",
    "",
    "## Recommendation",
    "",
    "Recommendation must be derived from the actual numbers in this report. If the numbers are mixed, keep the conclusion mixed rather than forcing a winner.",
    "",
  ].join("\n");

  FS.writeFileSync(outputPath, `${report}\n`, "utf8");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
