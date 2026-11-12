// The overlay check (entries + hooks + leak checks) and its human-readable
// rendering. Pure over OverlayIo.
import type { KodoManifest } from "./manifest.ts";
import {
  applyOverlay,
  checkHooks,
  type EntryResult,
  type HookResult,
  isFailingStatus,
  type LeakResult,
  type OverlayIo,
  runLeakChecks,
} from "./overlay.ts";

export interface CheckReport {
  readonly overlay: ReadonlyArray<EntryResult>;
  readonly hooks: ReadonlyArray<HookResult>;
  readonly leaks: ReadonlyArray<LeakResult>;
  // One actionable line per failure; empty means the overlay is fully applied.
  readonly problems: ReadonlyArray<string>;
  readonly placeholders: number;
}

export const buildCheckReport = (manifest: KodoManifest, io: OverlayIo): CheckReport => {
  const overlay = applyOverlay(manifest, io, { write: false });
  const hooks = checkHooks(manifest.hooks, io);
  const leaks = runLeakChecks(manifest.leakChecks, io);
  const problems = [
    ...overlay.flatMap((result) => {
      if (!isFailingStatus(result.status)) return [];
      return result.status === "pending"
        ? [`${result.section} "${result.id}" is not applied. Run kodo:apply.`]
        : result.details;
    }),
    ...hooks.flatMap((hook) =>
      hook.status === "missing-file" || hook.status === "missing-hooks" ? hook.details : [],
    ),
    ...leaks.flatMap((leak) =>
      leak.status === "leaks" || leak.status === "no-files"
        ? [
            ...leak.details,
            ...leak.hits.slice(0, 20).map((hit) => `  ${hit.file}:${hit.line}  ${hit.text}`),
          ]
        : [],
    ),
  ];
  const placeholders =
    overlay.filter((result) => result.status === "placeholder").length +
    hooks.filter((hook) => hook.status === "placeholder").length +
    leaks.filter((leak) => leak.status === "placeholder").length;
  return { overlay, hooks, leaks, problems, placeholders };
};

const SECTION_LABEL = {
  asset: "asset",
  replacement: "replace",
  jsonEdit: "json",
  codemod: "codemod",
} as const;

export const formatEntryResults = (
  results: ReadonlyArray<EntryResult>,
  compact = false,
): string[] => {
  const shown = compact ? results.filter((result) => result.status !== "already-applied") : results;
  const lines = shown.flatMap((result) => [
    `  ${result.status.padEnd(15)} ${SECTION_LABEL[result.section].padEnd(8)} ${result.id}`,
    ...(result.status === "already-applied"
      ? []
      : result.details.map((detail) => `      ${detail}`)),
  ]);
  const hidden = results.length - shown.length;
  return hidden > 0 ? [`  ${hidden} entries already-applied`, ...lines] : lines;
};

// Compact output hides the entries and hooks that need no attention (used by sync).
export const formatCheckReport = (report: CheckReport, compact = false): string[] => {
  const lines = ["Overlay entries:", ...formatEntryResults(report.overlay, compact)];
  lines.push("Required hooks:");
  const okHooks = report.hooks.filter((hook) => hook.status === "ok");
  if (compact && okHooks.length > 0) lines.push(`  ${okHooks.length} files ok`);
  for (const hook of compact ? report.hooks.filter((hook) => hook.status !== "ok") : report.hooks) {
    lines.push(`  ${hook.status.padEnd(15)} ${hook.file}`);
    if (hook.status !== "ok") lines.push(...hook.details.map((detail) => `      ${detail}`));
  }
  lines.push("Leak checks:");
  for (const leak of report.leaks) {
    lines.push(
      `  ${leak.status.padEnd(15)} ${leak.checkId} (${leak.fileCount} files, ${leak.allowedCount} allowed)`,
    );
    for (const detail of leak.details) lines.push(`      ${detail}`);
    for (const hit of leak.hits.slice(0, 20)) {
      lines.push(`      ${hit.file}:${hit.line}  ${hit.text}`);
    }
  }
  if (report.placeholders > 0) {
    lines.push(
      `${report.placeholders} TODO placeholder entr${report.placeholders === 1 ? "y" : "ies"} not enforced.`,
    );
  }
  if (report.problems.length > 0) {
    lines.push("Problems:", ...report.problems.map((problem) => `  ${problem}`));
  }
  lines.push(
    report.problems.length === 0
      ? "Overlay check: PASS"
      : `Overlay check: FAIL (${report.problems.length} problem line(s))`,
  );
  return lines;
};
