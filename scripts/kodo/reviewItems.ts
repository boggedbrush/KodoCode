// Things a clean merge can change without a conflict that may still need a human: a new provider,
// a new MCP tool or run-creation site, or an edit to a file that carries enforcement hooks. They
// are reported, never failed, because the tool cannot know whether upstream's addition is covered.
import { isPlaceholder, type KodoManifest } from "./manifest.ts";
import type { UpstreamChange } from "./touchpoints.ts";

export interface ReviewItem {
  readonly message: string;
}

// Hooked files here carry server, provider or mobile enforcement; web and desktop hooks are branding and UI.
export const isEnforcementPath = (path: string): boolean =>
  /^(?:apps\/server|apps\/mobile|packages)\//.test(path);

const isTestOrKit = (path: string): boolean => /\.(?:test|testkit|spec)\.[cm]?[jt]sx?$/.test(path);

const ENFORCEMENT_REMINDER =
  "Check that it has a read-only enforcement entry (the server test over registered provider drivers fails if not).";

const ADDED_TOOL = /^\+.*\bTool\.make\(\s*"([^"]+)"/;
const ADDED_RUN_LITERAL = /^\+.*:\s*OrchestrationV2Run\s*=\s*\{/;

export const findReviewItems = (input: {
  readonly manifest: KodoManifest;
  readonly changes: ReadonlyArray<UpstreamChange>;
  // `git diff -U0` of apps/server/src for the range; added lines are scanned for tools and runs.
  readonly serverDiff: string;
}): ReadonlyArray<ReviewItem> => {
  const items: ReviewItem[] = [];
  const added = input.changes.filter((change) => change.status === "A");
  for (const change of added) {
    if (/^packages\/provider-[^/]+\/package\.json$/.test(change.path)) {
      items.push({
        message: `new provider package ${change.path.split("/")[1]} added upstream. ${ENFORCEMENT_REMINDER}`,
      });
    } else if (
      /(?:Adapter(?:V\d)?|Driver)\.ts$/.test(change.path) &&
      /^(?:apps\/server|packages)\//.test(change.path) &&
      !isTestOrKit(change.path)
    ) {
      items.push({
        message: `new provider adapter or driver ${change.path} added upstream. ${ENFORCEMENT_REMINDER}`,
      });
    }
  }
  const tools = new Set<string>();
  let runSites = 0;
  let file = "";
  for (const line of input.serverDiff.split("\n")) {
    if (line.startsWith("+++ ")) file = line.slice(4).replace(/^b\//, "");
    if (isTestOrKit(file)) continue;
    const tool = ADDED_TOOL.exec(line)?.[1];
    if (tool !== undefined && file.includes("/mcp/")) tools.add(tool);
    if (ADDED_RUN_LITERAL.test(line)) runSites += 1;
  }
  if (tools.size > 0) {
    items.push({
      message: `MCP tool definition(s) added upstream: ${[...tools].toSorted().join(", ")}. Check each against the read-only guard (apps/server/src/mcp/kodoReadOnlyGuard.ts).`,
    });
  }
  if (runSites > 0) {
    items.push({
      message: `${runSites} new run-creation site(s) (an OrchestrationV2Run literal) added upstream. Check each records the mode (kodoRunModeSnapshot).`,
    });
  }
  const hooked = new Set(
    input.manifest.hooks.filter((entry) => !isPlaceholder(entry)).map((entry) => entry.file),
  );
  for (const change of input.changes) {
    const path = change.oldPath ?? change.path;
    if (change.status !== "D" && hooked.has(path) && isEnforcementPath(path)) {
      items.push({
        message: `${path} carries Kodo hooks and changed upstream. Read the diff; the hook may no longer mean what it did.`,
      });
    }
  }
  return items;
};

// A run-creation literal in the working tree without a mode snapshot nearby: reported as a
// likely gap, not a failure. A literal that starts by spreading an existing run is a copy.
export const findRunLiteralsWithoutSnapshot = (
  files: ReadonlyArray<{ readonly path: string; readonly text: string }>,
): ReadonlyArray<string> =>
  files.flatMap(({ path, text }) => {
    if (isTestOrKit(path)) return [];
    const lines = text.split("\n");
    return lines.flatMap((line, index) =>
      /:\s*OrchestrationV2Run\s*=\s*\{\s*$/.test(line) &&
      !/^\s*\.\.\.(?!kodoRunModeSnapshot)\w/.test(lines[index + 1] ?? "") &&
      !lines.slice(index, index + 40).some((candidate) => candidate.includes("kodoRunModeSnapshot"))
        ? [`${path}:${index + 1}`]
        : [],
    );
  });
