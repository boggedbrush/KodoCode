// Rendering of docs/upstream-sync-log.md entries. Pure: the engine gathers the
// facts, this module only formats them in the log's existing style.
import type { EntryResult, HookResult, LeakResult, OwnedPathViolation } from "./overlay.ts";

export interface VerificationOutcome {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface SyncLogEntry {
  readonly date: string;
  readonly branch: string;
  readonly forkRepo: string;
  readonly forkBase: string;
  readonly upstreamRepo: string;
  readonly upstreamRef: string;
  readonly rangeFrom: string;
  readonly rangeTo: string;
  readonly commitCount: number;
  readonly autoResolved: ReadonlyArray<{ readonly path: string; readonly why: string }>;
  // Conflicts a human or agent resolved after the script stopped (sync --continue).
  readonly resolvedByHand: ReadonlyArray<string>;
  readonly applyResults: ReadonlyArray<EntryResult>;
  readonly applyChangedFiles: ReadonlyArray<string>;
  readonly hooks: ReadonlyArray<HookResult>;
  readonly leaks: ReadonlyArray<LeakResult>;
  readonly ownedViolations: ReadonlyArray<OwnedPathViolation>;
  readonly checkProblems: ReadonlyArray<string>;
  readonly verification: ReadonlyArray<VerificationOutcome>;
  readonly followUps: ReadonlyArray<string>;
}

const short = (sha: string): string => sha.slice(0, 10);
const code = (text: string): string => `\`${text}\``;
const bullets = (items: ReadonlyArray<string>, empty = "- None."): string[] =>
  items.length > 0 ? items.map((item) => `- ${item}`) : [empty];

const countBy = (results: ReadonlyArray<EntryResult>) => {
  const counts = new Map<string, number>();
  for (const result of results) counts.set(result.status, (counts.get(result.status) ?? 0) + 1);
  return [...counts].map(([status, count]) => `${count} ${status}`).join(", ") || "no entries";
};

export const renderSyncLogEntry = (entry: SyncLogEntry): string => {
  const lines: string[] = [
    `## ${entry.date}`,
    "",
    `- Fork branch: ${code(entry.branch)}`,
    `- Fork base: ${code(`${entry.forkRepo}@${short(entry.forkBase)}`)}`,
    `- Upstream range: ${code(`${entry.upstreamRepo}@${short(entry.rangeFrom)}..${short(entry.rangeTo)}`)} (${entry.upstreamRef}), ${entry.commitCount} commit${entry.commitCount === 1 ? "" : "s"}`,
    "- Tool: `kodo:sync` (scripts/kodo)",
    "",
    "### Auto-resolved conflicts",
    "",
    ...bullets(entry.autoResolved.map((item) => `${code(item.path)}: ${item.why}`)),
  ];
  if (entry.resolvedByHand.length > 0) {
    lines.push("", "### Resolved by hand", "", ...bullets(entry.resolvedByHand.map(code)));
  }
  lines.push(
    "",
    "### Overlay re-applied",
    "",
    `- Entries: ${countBy(entry.applyResults)}.`,
    ...bullets(
      entry.applyChangedFiles.map(code),
      "- apply changed no files (the merge already left the overlay intact).",
    ),
  );
  const unresolved = entry.applyResults.filter(
    (result) =>
      result.status === "target-missing" ||
      result.status === "mismatch" ||
      result.status === "source-missing",
  );
  if (unresolved.length > 0) {
    lines.push(
      "",
      "Unresolved overlay entries:",
      ...unresolved.flatMap((r) => r.details.map((d) => `- ${d}`)),
    );
  }
  const hookProblems = entry.hooks.filter(
    (hook) => hook.status === "missing-file" || hook.status === "missing-hooks",
  );
  const leakProblems = entry.leaks.filter(
    (leak) => leak.status === "leaks" || leak.status === "no-files",
  );
  lines.push(
    "",
    "### Hooks and leaks",
    "",
    `- Required hooks: ${entry.hooks.filter((hook) => hook.status === "ok").length}/${entry.hooks.filter((hook) => hook.status !== "placeholder").length} files intact${hookProblems.length > 0 ? ", problems below" : ""}.`,
    ...hookProblems.flatMap((hook) => hook.details.map((detail) => `  - ${detail}`)),
    `- Leak checks: ${entry.leaks.filter((leak) => leak.status === "ok").length}/${entry.leaks.filter((leak) => leak.status !== "placeholder").length} clean${leakProblems.length > 0 ? ", problems below" : ""}.`,
    ...leakProblems.flatMap((leak) => [
      ...leak.details.map((detail) => `  - ${detail}`),
      ...leak.hits
        .slice(0, 10)
        .map((hit) => `    - ${code(`${hit.file}:${hit.line}`)} ${hit.text}`),
    ]),
    ...entry.ownedViolations.map(
      (violation) =>
        `- Warning: upstream now ships ${code(violation.file)} inside Kodo-owned ${code(violation.owned)}.`,
    ),
    "",
    "### Checks",
    "",
    entry.checkProblems.length === 0
      ? "- `kodo:check`: pass."
      : `- ${code("kodo:check")}: FAIL (${entry.checkProblems.length} problem${entry.checkProblems.length === 1 ? "" : "s"}).`,
    ...entry.verification.map(
      (outcome) =>
        `- ${code(outcome.name)}: ${outcome.ok ? "pass" : "FAIL"}${outcome.detail ? ` (${outcome.detail})` : ""}`,
    ),
  );
  if (entry.followUps.length > 0) {
    lines.push("", "### Follow-ups", "", ...entry.followUps.map((item) => `- ${item}`));
  }
  return `${lines.join("\n")}\n`;
};

// Entries are newest first, directly under the log's title.
export const insertSyncLogEntry = (existing: string, rendered: string): string => {
  const titleMatch = /^# .*\n/.exec(existing);
  if (!titleMatch)
    return `# Upstream Sync Log\n\n${rendered}${existing === "" ? "" : `\n${existing}`}`;
  const head = existing.slice(0, titleMatch[0].length);
  const rest = existing.slice(titleMatch[0].length).replace(/^\n+/, "");
  return `${head}\n${rendered}${rest === "" ? "" : `\n${rest}`}`;
};
