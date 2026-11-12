// The Kodo overlay commands over a real git working tree: apply, check and
// sync (with --dry-run and --continue). Policy lives in the sibling pure
// modules; this file sequences git and filesystem effects. It never pushes,
// never forces, and never commits a tree that still has conflict markers.
import {
  classifyConflicts,
  describeShape,
  parseUnmergedIndex,
  type ClassifiedConflict,
  type ConflictContext,
} from "./conflicts.ts";
import {
  createFsIo,
  git,
  GitCommandError,
  gitLines,
  gitNulList,
  gitOrThrow,
  readTextIfExists,
  resolvePath,
  removeFileIfExists,
  runCommand,
  writeText,
  type CommandResult,
} from "./git.ts";
import {
  codemodInScope,
  codemodKeepsFile,
  codemodOptionsFor,
  isCodemodOutput,
} from "./brandCodemodRun.ts";
import { normalizedTokens, transformBrandLiterals } from "./brandCodemod.ts";
import {
  isPrereleaseBeyond,
  newestStableTag,
  parseUpstreamBase,
  RELEASE_POLICY_MESSAGE,
  RELEASE_POLICY_SUMMARY,
  renderUpstreamBase,
  isStableTag,
  stableTagsNewestFirst,
  syncBranchBase,
} from "./releases.ts";
import { diffTokens } from "./tokenDiff.ts";
import { isPlaceholder, type KodoManifest } from "./manifest.ts";
import { matchesOwnedPath } from "./paths.ts";
import {
  applyOverlay,
  checkHooks,
  type EntryResult,
  findOwnedPathViolations,
  isUnresolvedStatus,
} from "./overlay.ts";
import {
  buildCheckReport,
  formatCheckReport,
  formatEntryResults,
  type CheckReport,
} from "./report.ts";
import {
  insertSyncLogEntry,
  renderSyncLogEntry,
  type SyncLogEntry,
  type VerificationOutcome,
} from "./syncLog.ts";
import { findTouchpoints, parseNameStatusZ } from "./touchpoints.ts";

export interface EngineContext {
  readonly root: string;
  readonly manifest: KodoManifest;
  readonly log: (line: string) => void;
  // YYYY-MM-DD, supplied by the caller so the engine never reads the clock.
  readonly today: string;
  // Run verification commands through a shell (Windows shims).
  readonly shell?: boolean;
  // Hide entries and hooks that need no attention (sync's long run).
  readonly compact?: boolean;
  // Replaceable in tests so verification does not shell out to vp.
  readonly exec?: (root: string, argv: ReadonlyArray<string>) => CommandResult;
}

const short = (sha: string): string => sha.slice(0, 10);

export interface ApplyOutcome {
  readonly results: ReadonlyArray<EntryResult>;
  readonly changedFiles: ReadonlyArray<string>;
  readonly exitCode: number;
}

export const runApply = (ctx: EngineContext): ApplyOutcome => {
  const io = createFsIo(ctx.root);
  const results = applyOverlay(ctx.manifest, io, { write: true });
  const changedFiles = io.writtenPaths();
  const unresolved = results.filter((result) => isUnresolvedStatus(result.status));
  ctx.log("Overlay entries:");
  for (const line of formatEntryResults(results, ctx.compact)) ctx.log(line);
  ctx.log(
    changedFiles.length === 0
      ? "apply: no files changed."
      : `apply: changed ${changedFiles.length} file(s).`,
  );
  if (unresolved.length > 0) {
    ctx.log(
      `apply: ${unresolved.length} entr${unresolved.length === 1 ? "y" : "ies"} could not be applied; fix the manifest entries named above.`,
    );
  }
  const hookProblems = checkHooks(ctx.manifest.hooks, io).filter(
    (hook) => hook.status === "missing-file" || hook.status === "missing-hooks",
  );
  if (hookProblems.length > 0) {
    ctx.log("Required hooks that apply cannot restore (re-add them by hand):");
    for (const hook of hookProblems) for (const detail of hook.details) ctx.log(`  ${detail}`);
  }
  const failed = unresolved.length > 0 || hookProblems.length > 0;
  return { results, changedFiles, exitCode: failed ? 1 : 0 };
};

// Files carrying a `KODO:` marker that no hooks entry or Kodo-owned path accounts for.
export const findUnlistedMarkerFiles = (ctx: EngineContext): ReadonlyArray<string> => {
  const found = git(ctx.root, ["grep", "-l", "--untracked", "-F", "KODO:", "--", "."]);
  const listed = new Set(
    ctx.manifest.hooks.filter((entry) => !isPlaceholder(entry)).map((entry) => entry.file),
  );
  return found.stdout
    .split("\n")
    .filter(
      (path) =>
        path !== "" &&
        path !== ctx.manifest.upstream.logFile &&
        !listed.has(path) &&
        !ctx.manifest.kodoOwned.some((owned) => matchesOwnedPath(path, owned.path)),
    );
};

export const runCheck = (
  ctx: EngineContext,
  options: { readonly requireRelease?: boolean } = {},
): { report: CheckReport; exitCode: number } => {
  const report = buildCheckReport(ctx.manifest, createFsIo(ctx.root));
  for (const line of formatCheckReport(report, ctx.compact)) ctx.log(line);
  const unlisted = findUnlistedMarkerFiles(ctx);
  if (unlisted.length > 0) {
    ctx.log(
      `WARNING: ${unlisted.length} file(s) carry a "KODO:" marker the manifest does not list; add them under hooks so a lost marker is caught:`,
    );
    for (const path of unlisted) ctx.log(`  ${path}`);
  }
  const baseWarnings = baseWarningsFor(ctx);
  for (const warning of baseWarnings) ctx.log(`WARNING: ${warning}`);
  const gateFails = options.requireRelease === true && baseWarnings.length > 0;
  if (gateFails) ctx.log("Release gate: FAIL (the fork is not on a stable upstream release).");
  return { report, exitCode: report.problems.length === 0 && !gateFails ? 0 : 1 };
};

export interface SyncOptions {
  readonly ref?: string;
  readonly dryRun: boolean;
  readonly resume: boolean;
  // Fetch the upstream remote first (default). Off for offline use and tests.
  readonly fetch: boolean;
  // Run the manifest's verification commands after the check (default).
  readonly verify: boolean;
  // Allow a --ref that is not a stable release tag (a branch, preview, nightly or commit).
  readonly allowUnreleased?: boolean;
}

export type SyncStatus =
  | "refused"
  | "error"
  | "up-to-date"
  | "dry-run"
  | "stopped-for-conflicts"
  | "completed"
  | "completed-with-failures";

export interface SyncOutcome {
  readonly status: SyncStatus;
  readonly exitCode: number;
  readonly branch?: string;
  readonly conflicts?: ReadonlyArray<string>;
}

interface SyncState {
  readonly branch: string;
  readonly originalBranch: string;
  readonly ref: string;
  readonly rangeFrom: string;
  readonly rangeTo: string;
  readonly commitCount: number;
  readonly forkBase: string;
  // The stable release tag being synced to, when the ref is one.
  readonly releaseTag?: string;
  readonly autoResolved: ReadonlyArray<{ readonly path: string; readonly why: string }>;
  readonly manual: ReadonlyArray<string>;
  readonly followUps: ReadonlyArray<string>;
}

const REINSTALL_NOTE =
  "Dependencies or the lockfile changed upstream. Reinstall (`vp i`); this tool never runs the install.";

const stateFile = (root: string): string =>
  resolvePath(root, gitOrThrow(root, ["rev-parse", "--git-path", "kodo-sync-state.json"]).trim());

const readState = (root: string): SyncState | undefined => {
  const path = stateFile(root);
  const text = readTextIfExists("/", path);
  return text === undefined ? undefined : (JSON.parse(text) as SyncState);
};

const mergeInProgress = (root: string): boolean =>
  git(root, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).status === 0;

const hasConflictMarkers = (text: string): boolean =>
  /^<{7}(?: |$)/m.test(text) && /^>{7}(?: |$)/m.test(text);

// Conflict facts from git: is our version of a file just the codemod's output for the merge base?
const codemodContext = (ctx: EngineContext, mergeBase: string): ConflictContext => {
  const config = ctx.manifest.brandCodemod;
  return {
    isCodemodOwned: (path) => {
      if (!config) return false;
      const base = git(ctx.root, ["show", `${mergeBase}:${path}`]);
      const ours = git(ctx.root, ["show", `HEAD:${path}`]);
      return (
        base.status === 0 &&
        ours.status === 0 &&
        isCodemodOutput(config, path, base.stdout, ours.stdout)
      );
    },
  };
};

const refuse = (ctx: EngineContext, ...lines: string[]): SyncOutcome => {
  for (const line of lines) ctx.log(line);
  return { status: "refused", exitCode: 1 };
};

export const runSync = (fullContext: EngineContext, options: SyncOptions): SyncOutcome => {
  const ctx = { ...fullContext, compact: fullContext.compact ?? true };
  try {
    return options.resume ? resumeSync(ctx, options) : startSync(ctx, options);
  } catch (error) {
    if (error instanceof GitCommandError) {
      ctx.log(`ERROR: ${error.message}`);
      return { status: "error", exitCode: 1 };
    }
    throw error;
  }
};

const startSync = (ctx: EngineContext, options: SyncOptions): SyncOutcome => {
  const { root, manifest, log } = ctx;
  const { remote } = manifest.upstream;

  if (!options.dryRun) {
    if (mergeInProgress(root)) {
      return refuse(
        ctx,
        "REFUSED: a merge is already in progress.",
        "Resolve it and run `kodo:sync --continue`, or abort it with `git merge --abort`.",
      );
    }
    const dirty = gitLines(root, ["status", "--porcelain"]);
    if (dirty.length > 0) {
      return refuse(
        ctx,
        `REFUSED: the working tree is not clean (${dirty.length} path(s)); commit or stash first.`,
        ...dirty.slice(0, 10).map((line) => `  ${line}`),
        ...(dirty.length > 10 ? [`  ... and ${dirty.length - 10} more`] : []),
      );
    }
  }
  const originalBranch = git(root, ["symbolic-ref", "--short", "-q", "HEAD"]).stdout.trim();
  if (!options.dryRun && originalBranch === "") {
    return refuse(ctx, "REFUSED: HEAD is detached; check out the branch to sync first.");
  }

  if (options.fetch) {
    const fetched = git(root, ["fetch", remote, "--tags"]);
    if (fetched.status !== 0) {
      const message = `git fetch ${remote} --tags failed: ${fetched.stderr.trim()}`;
      if (!options.dryRun)
        return refuse(
          ctx,
          `REFUSED: ${message}`,
          "Use --no-fetch to merge what is already fetched.",
        );
      log(`WARNING: ${message}. Using the locally known refs.`);
    }
  }
  const newest = newestStableTag(listTags(root));
  let ref = options.ref;
  if (ref === undefined) {
    if (newest === undefined) {
      return refuse(
        ctx,
        `REFUSED: no stable release tag (vX.Y.Z) found for ${remote}. ${RELEASE_POLICY_MESSAGE}`,
        options.fetch ? "" : "Run without --no-fetch to fetch the tags first.",
      );
    }
    ref = newest;
  } else if (!isStableRelease(root, ref)) {
    const note = `"${ref}" is not a stable upstream release. ${RELEASE_POLICY_MESSAGE}`;
    if (!options.dryRun && options.allowUnreleased !== true) return refuse(ctx, `REFUSED: ${note}`);
    log(
      options.dryRun
        ? `NOTE: ${note} (a real sync would refuse it).`
        : `WARNING: syncing to an unreleased ref (--allow-unreleased): ${ref}`,
    );
  }
  const resolved = git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  if (resolved.status !== 0) {
    return refuse(
      ctx,
      `REFUSED: upstream ref "${ref}" does not resolve to a commit.`,
      options.fetch
        ? "Check the --ref value and the remote name in the manifest."
        : "Run without --no-fetch to fetch it first.",
    );
  }
  const rangeTo = resolved.stdout.trim();
  const base = git(root, ["merge-base", "HEAD", rangeTo]);
  if (base.status !== 0) {
    return refuse(ctx, `REFUSED: HEAD and ${ref} share no history (no merge base).`);
  }
  const rangeFrom = base.stdout.trim();
  if (git(root, ["merge-base", "--is-ancestor", rangeTo, "HEAD"]).status === 0) {
    log(
      options.ref === undefined
        ? `Already on the latest stable release ${ref} (${short(rangeTo)}).`
        : `Already up to date: ${ref} (${short(rangeTo)}) is contained in HEAD.`,
    );
    return { status: "up-to-date", exitCode: 0 };
  }
  const commitCount = Number(
    gitOrThrow(root, ["rev-list", "--count", `${rangeFrom}..${rangeTo}`]).trim(),
  );

  if (options.dryRun) return dryRun(ctx, { ref, rangeFrom, rangeTo, commitCount });

  const forkBase = gitOrThrow(root, ["rev-parse", "HEAD"]).trim();
  const branch = freshBranchName(root, syncBranchBase(ref, ctx.today));
  gitOrThrow(root, ["switch", "-c", branch]);
  log(`Created branch ${branch} from ${originalBranch} (${short(forkBase)}).`);
  log(`Merging ${ref} (${short(rangeTo)}), ${commitCount} commit(s) since ${short(rangeFrom)}...`);

  const merge = git(root, ["merge", "--no-commit", "--no-ff", rangeTo]);
  const unmerged = parseUnmergedIndex(gitOrThrow(root, ["ls-files", "-u", "-z"]));
  if (merge.status !== 0 && unmerged.length === 0) {
    git(root, ["merge", "--abort"]);
    git(root, ["switch", originalBranch]);
    git(root, ["branch", "-d", branch]);
    ctx.log(
      `ERROR: git merge failed before producing conflicts: ${(merge.stderr || merge.stdout).trim()}`,
    );
    log(`Rolled back: back on ${originalBranch}, branch ${branch} removed.`);
    return { status: "error", exitCode: 1 };
  }

  const classified = classifyConflicts(unmerged, manifest, codemodContext(ctx, rangeFrom));
  const autoResolved = classified.flatMap((conflict) => resolveAutomatically(ctx, conflict));
  const manual = classified.filter((conflict) => conflict.resolution.kind === "manual");
  const takesLockfile = classified.some(
    (conflict) =>
      conflict.resolution.kind === "theirs" && conflict.resolution.followUp === "reinstall",
  );
  const followUps = takesLockfile ? [REINSTALL_NOTE] : [];
  const state: SyncState = {
    branch,
    originalBranch,
    ref,
    rangeFrom,
    rangeTo,
    commitCount,
    forkBase,
    ...(isStableTag(ref) ? { releaseTag: ref } : {}),
    autoResolved,
    manual: manual.map((conflict) => conflict.path),
    followUps,
  };
  writeText("/", stateFile(root), `${JSON.stringify(state, null, 2)}\n`);

  for (const item of autoResolved) log(`  auto-resolved ${item.path}: ${item.why}`);
  const owned = findOwnedPathViolations(
    manifest.kodoOwned,
    gitNulList(root, ["ls-tree", "-r", "-z", "--name-only", rangeTo]),
  );
  for (const violation of owned) {
    log(`  WARNING: upstream ships ${violation.file} inside Kodo-owned ${violation.owned}.`);
  }
  if (manual.length > 0) {
    log("");
    log(`STOPPED: ${manual.length} conflict(s) need a human or agent. Nothing has been committed.`);
    for (const conflict of manual) {
      log(
        `  CONFLICT ${conflict.path}: ${conflict.resolution.kind === "manual" ? conflict.resolution.why : ""}`,
      );
      if (conflict.resolution.kind === "manual") {
        for (const hint of conflict.resolution.hints) log(`      hint: ${hint}`);
      }
    }
    log("");
    log("Resolve each file, `git add` it, then run `kodo:sync --continue`.");
    log(`To give up: git merge --abort && git switch ${originalBranch} && git branch -D ${branch}`);
    return { status: "stopped-for-conflicts", exitCode: 1, branch, conflicts: state.manual };
  }
  return finalize(ctx, state, options);
};

const freshBranchName = (root: string, base: string): string => {
  for (let attempt = 1; ; attempt++) {
    const name = attempt === 1 ? base : `${base}-${attempt}`;
    if (git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`]).status !== 0)
      return name;
  }
};

const resolveAutomatically = (
  ctx: EngineContext,
  conflict: ClassifiedConflict,
): Array<{ path: string; why: string }> => {
  const { resolution, path } = conflict;
  if (resolution.kind === "manual") return [];
  const side = resolution.kind === "ours" ? "--ours" : "--theirs";
  const present = resolution.kind === "ours" ? conflict.hasOurs : conflict.hasTheirs;
  if (present) {
    gitOrThrow(ctx.root, ["checkout", side, "--", path]);
    gitOrThrow(ctx.root, ["add", "--", path]);
  } else {
    gitOrThrow(ctx.root, ["rm", "-q", "--", path]);
  }
  return [{ path, why: resolution.why }];
};

const resumeSync = (ctx: EngineContext, options: SyncOptions): SyncOutcome => {
  const state = readState(ctx.root);
  if (!state) {
    return refuse(
      ctx,
      "REFUSED: no sync in progress (kodo-sync-state.json not found in .git). Start with `kodo:sync`.",
    );
  }
  const current = git(ctx.root, ["symbolic-ref", "--short", "-q", "HEAD"]).stdout.trim();
  if (current !== state.branch) {
    return refuse(
      ctx,
      `REFUSED: the sync is on branch ${state.branch} but ${current || "a detached HEAD"} is checked out.`,
    );
  }
  return finalize(ctx, state, options);
};

const verificationCommands = (
  manifest: KodoManifest,
): ReadonlyArray<{ name: string; argv: ReadonlyArray<string> }> => [
  ...(manifest.verify.testFiles.length > 0
    ? [{ name: "vp test run", argv: ["vp", "test", "run", ...manifest.verify.testFiles] }]
    : []),
  ...manifest.verify.typecheckPackages.map((pkg) => ({
    name: `typecheck ${pkg}`,
    argv: ["vp", "run", "--filter", pkg, "typecheck"],
  })),
  ...manifest.verify.commands,
];

const finalize = (ctx: EngineContext, state: SyncState, options: SyncOptions): SyncOutcome => {
  const { root, manifest, log } = ctx;

  const unmerged = parseUnmergedIndex(gitOrThrow(root, ["ls-files", "-u", "-z"]));
  if (unmerged.length > 0) {
    return refuse(
      ctx,
      `REFUSED: ${unmerged.length} path(s) are still unmerged. Resolve and \`git add\` them first:`,
      ...unmerged.map((file) => `  ${file.path} (${describeShape(file)})`),
    );
  }
  if (git(root, ["diff", "--quiet"]).status !== 0) {
    return refuse(
      ctx,
      "REFUSED: tracked files have unstaged changes. `git add` your conflict resolutions first so they are part of the merge commit.",
      ...gitLines(root, ["diff", "--name-only"]).map((path) => `  ${path}`),
    );
  }
  const touched = [...state.manual, ...state.autoResolved.map((item) => item.path)];
  const withMarkers = touched.filter((path) => {
    const text = readTextIfExists(root, path);
    return text !== undefined && hasConflictMarkers(text);
  });
  if (withMarkers.length > 0) {
    return refuse(
      ctx,
      "REFUSED: conflict markers (<<<<<<< ... >>>>>>>) are still present; refusing to commit them:",
      ...withMarkers.map((path) => `  ${path}`),
    );
  }

  const hasMerge = mergeInProgress(root);
  if (hasMerge) {
    gitOrThrow(root, [
      "commit",
      "-m",
      `Merge ${state.ref} (${short(state.rangeTo)}) into ${state.branch}`,
    ]);
    log(`Committed the merge of ${state.ref} (${short(state.rangeTo)}).`);
  }

  log("");
  log("Applying the Kodo overlay...");
  const apply = runApply(ctx);
  if (apply.changedFiles.length > 0) {
    gitOrThrow(root, ["add", "--", ...apply.changedFiles]);
    if (git(root, ["diff", "--cached", "--quiet"]).status !== 0) {
      gitOrThrow(root, ["commit", "-m", "kodo: re-apply overlay after upstream sync"]);
    }
  }

  const baseFile = manifest.upstream.baseFile;
  if (baseFile !== undefined) {
    writeText(
      root,
      baseFile,
      renderUpstreamBase({
        tag: state.releaseTag,
        commit: state.rangeTo,
        synced: ctx.today,
      }),
    );
  }

  log("");
  log("Checking the overlay...");
  const check = runCheck(ctx);

  const upstreamFiles = gitNulList(root, ["ls-tree", "-r", "-z", "--name-only", state.rangeTo]);
  const ownedViolations = findOwnedPathViolations(manifest.kodoOwned, upstreamFiles);
  for (const violation of ownedViolations) {
    log(`WARNING: upstream now ships ${violation.file} inside Kodo-owned ${violation.owned}.`);
  }

  const verification: VerificationOutcome[] = [];
  if (options.verify) {
    const exec = ctx.exec ?? ((dir, argv) => runCommand(dir, argv, ctx.shell ?? false));
    for (const command of verificationCommands(manifest)) {
      log("");
      log(`Verifying: ${command.argv.join(" ")}`);
      const result = exec(root, command.argv);
      verification.push({
        name: command.name,
        ok: result.ok,
        detail: result.ok ? "" : `exit ${result.status}`,
      });
      if (!result.ok) {
        for (const line of result.output.trimEnd().split("\n").slice(-30)) log(`    ${line}`);
      }
    }
  }

  const changedUpstream = parseNameStatusZ(
    gitOrThrow(root, ["diff", "--name-status", "-M", "-z", state.rangeFrom, state.rangeTo]),
  );
  const dependencyChanged = changedUpstream.some(
    (change) =>
      manifest.upstream.lockfiles.includes(change.path) || /(^|\/)package\.json$/.test(change.path),
  );
  const followUps = [
    ...new Set([...state.followUps, ...(dependencyChanged ? [REINSTALL_NOTE] : [])]),
  ];

  const entry: SyncLogEntry = {
    date: ctx.today,
    branch: state.branch,
    forkRepo: manifest.upstream.forkRepo,
    forkBase: state.forkBase,
    upstreamRepo: manifest.upstream.repo,
    upstreamRef: state.ref,
    rangeFrom: state.rangeFrom,
    rangeTo: state.rangeTo,
    commitCount: state.commitCount,
    autoResolved: state.autoResolved,
    resolvedByHand: state.manual,
    applyResults: apply.results,
    applyChangedFiles: apply.changedFiles,
    hooks: check.report.hooks,
    leaks: check.report.leaks,
    ownedViolations,
    checkProblems: check.report.problems,
    verification,
    followUps,
  };
  const logPath = manifest.upstream.logFile;
  writeText(
    root,
    logPath,
    insertSyncLogEntry(readTextIfExists(root, logPath) ?? "", renderSyncLogEntry(entry)),
  );
  gitOrThrow(root, ["add", "--", logPath, ...(baseFile === undefined ? [] : [baseFile])]);
  gitOrThrow(root, ["commit", "-m", `docs: record upstream sync ${state.releaseTag ?? ctx.today}`]);
  removeFileIfExists(stateFile(root));

  const failed = check.exitCode !== 0 || verification.some((outcome) => !outcome.ok);
  log("");
  log(`${failed ? "DONE WITH FAILURES" : "DONE"}: branch ${state.branch}. Nothing was pushed.`);
  if (failed)
    log(
      "Fix the problems above (the log entry records them), amend as needed, then review the branch.",
    );
  for (const item of followUps) log(`TODO: ${item}`);
  return {
    status: failed ? "completed-with-failures" : "completed",
    exitCode: failed ? 1 : 0,
    branch: state.branch,
  };
};

const dryRun = (
  ctx: EngineContext,
  range: { ref: string; rangeFrom: string; rangeTo: string; commitCount: number },
): SyncOutcome => {
  const { root, manifest, log } = ctx;
  const changes = parseNameStatusZ(
    gitOrThrow(root, ["diff", "--name-status", "-M", "-z", range.rangeFrom, range.rangeTo]),
  );
  const ourChanges = new Set(
    gitNulList(root, ["diff", "--name-only", "-z", range.rangeFrom, "HEAD"]),
  );
  log(`DRY RUN: nothing in the working tree or branches will change.`);
  log(`Upstream ${range.ref} (${short(range.rangeTo)}) vs merge base ${short(range.rangeFrom)}:`);
  log(
    `  ${range.commitCount} commit(s), ${changes.length} file(s) changed upstream, ${ourChanges.size} changed on our side.`,
  );

  // merge-tree simulates the merge in memory; it only writes unreferenced objects.
  const simulated = git(root, [
    "merge-tree",
    "--write-tree",
    "-z",
    "--no-messages",
    "HEAD",
    range.rangeTo,
  ]);
  log("");
  if (simulated.status === 0) {
    log("Merge simulation: clean, no conflicts.");
  } else if (simulated.status === 1) {
    const conflicts = classifyConflicts(
      parseUnmergedIndex(simulated.stdout),
      manifest,
      codemodContext(ctx, range.rangeFrom),
    );
    const manual = conflicts.filter((conflict) => conflict.resolution.kind === "manual");
    log(
      `Merge simulation: ${conflicts.length} conflicting file(s), ${conflicts.length - manual.length} auto-resolvable, ${manual.length} need a human.`,
    );
    for (const conflict of conflicts) {
      const resolution = conflict.resolution;
      log(
        `  ${resolution.kind === "manual" ? "MANUAL" : `auto:${resolution.kind}`.padEnd(6)} ${conflict.path}: ${resolution.why}`,
      );
      if (resolution.kind === "manual")
        for (const hint of resolution.hints) log(`      hint: ${hint}`);
    }
  } else {
    const both = changes.filter(
      (change) => ourChanges.has(change.path) || ourChanges.has(change.oldPath ?? ""),
    );
    log(
      `Merge simulation unavailable (${simulated.stderr.trim() || "git too old"}); files changed on both sides, which may conflict: ${both.length}`,
    );
    for (const change of both.slice(0, 40)) log(`  ${change.path}`);
  }

  const touchpoints = findTouchpoints(manifest, changes);
  log("");
  log(`Kodo overlay touched by this range: ${touchpoints.length} item(s).`);
  for (const touchpoint of touchpoints.toSorted((a, b) => a.severity.localeCompare(b.severity))) {
    log(
      `  ${touchpoint.severity === "attention" ? "ATTENTION" : "info     "} ${touchpoint.message}`,
    );
  }
  const owned = findOwnedPathViolations(
    manifest.kodoOwned,
    gitNulList(root, ["ls-tree", "-r", "-z", "--name-only", range.rangeTo]),
  );
  for (const violation of owned) {
    log(`WARNING: upstream ships ${violation.file} inside Kodo-owned ${violation.owned}.`);
  }
  const placeholders = [
    ...manifest.assets,
    ...manifest.replacements,
    ...manifest.jsonEdits,
    ...manifest.hooks,
    ...manifest.leakChecks,
  ].filter((entry) => isPlaceholder(entry)).length;
  if (placeholders > 0) {
    log(
      `Note: ${placeholders} manifest placeholder entr${placeholders === 1 ? "y is" : "ies are"} not enforced, so touchpoints for them are not listed.`,
    );
  }
  return { status: "dry-run", exitCode: 0 };
};

export interface CodemodAuditEntry {
  readonly path: string;
  readonly verdict: "match" | "differs" | "unsafe" | "kept" | "new-file";
  readonly detail: string;
}

// Runs the codemod on `ref`'s version of every in-scope file and compares it with
// the working tree (ignoring formatting): a match means the file is codemod-owned,
// a difference means hand edits beyond branding (or a codemod gap).
export const runCodemodAudit = (
  ctx: EngineContext,
  ref: string,
): { entries: ReadonlyArray<CodemodAuditEntry>; exitCode: number } => {
  const config = ctx.manifest.brandCodemod;
  if (!config) {
    ctx.log("No brandCodemod section in the manifest.");
    return { entries: [], exitCode: 1 };
  }
  const io = createFsIo(ctx.root);
  const entries: CodemodAuditEntry[] = [];
  for (const path of io.listFiles()) {
    if (!codemodInScope(config, path)) continue;
    const current = readTextIfExists(ctx.root, path);
    const upstream = git(ctx.root, ["show", `${ref}:${path}`]);
    if (current === undefined) continue;
    if (upstream.status !== 0) {
      entries.push({ path, verdict: "new-file", detail: `not in ${ref}` });
      continue;
    }
    if (codemodKeepsFile(config, path)) {
      entries.push({ path, verdict: "kept", detail: "whole file is on the keep list" });
      continue;
    }
    const result = transformBrandLiterals(upstream.stdout, path, codemodOptionsFor(config, path));
    if (result.reports.length > 0) {
      entries.push({
        path,
        verdict: "unsafe",
        detail: result.reports.map((r) => `line ${r.line}: ${r.reason}: ${r.text}`).join("; "),
      });
      continue;
    }
    const expected = normalizedTokens(result.output, path);
    const actual = normalizedTokens(current, path);
    if (expected.length === actual.length && expected.every((token, i) => token === actual[i])) {
      if (result.rewritten > 0 || current !== upstream.stdout) {
        entries.push({ path, verdict: "match", detail: `${result.rewritten} literal(s)` });
      }
      continue;
    }
    entries.push({ path, verdict: "differs", detail: describeTokenDifference(expected, actual) });
  }
  for (const entry of entries) {
    ctx.log(`  ${entry.verdict.padEnd(9)} ${entry.path}`);
    if (entry.verdict !== "match") ctx.log(`      ${entry.detail}`);
  }
  const count = (verdict: CodemodAuditEntry["verdict"]) =>
    entries.filter((entry) => entry.verdict === verdict).length;
  ctx.log(
    `codemod-audit vs ${ref}: ${count("match")} match, ${count("differs")} differ, ${count("unsafe")} unsafe, ${count("kept")} kept, ${count("new-file")} new.`,
  );
  return { entries, exitCode: count("unsafe") > 0 ? 1 : 0 };
};

// The differing token ranges, so a reviewer can see what is not branding.
const describeTokenDifference = (expected: string[], actual: string[]): string => {
  const hunks = diffTokens(expected, actual);
  if (!hunks) return "differs by too much to summarise";
  const show = (tokens: string[], from: number, to: number) =>
    tokens.slice(from, to).join(" ").replace(/\s+/g, " ").slice(0, 110);
  const shown = hunks
    .slice(0, 6)
    .map(
      (hunk) =>
        `codemod [${show(expected, hunk.aStart, hunk.aEnd)}] -> file [${show(actual, hunk.bStart, hunk.bEnd)}]`,
    );
  return `${hunks.length} hunk(s): ${shown.join("; ")}${hunks.length > 6 ? "; ..." : ""}`;
};

const listTags = (root: string): string[] => gitLines(root, ["tag", "--list", "v*"]);

const isStableRelease = (root: string, ref: string): boolean =>
  isStableTag(ref) &&
  git(root, ["show-ref", "--verify", "--quiet", `refs/tags/${ref}`]).status === 0;

export interface BaseInfo {
  // Newest stable release contained in HEAD.
  readonly baseTag: string | undefined;
  // Upstream commits in HEAD beyond that release (a merged main), when upstream main is known.
  readonly unreleasedCount: number;
}

export const detectBase = (ctx: EngineContext): BaseInfo => {
  const { root, manifest } = ctx;
  const baseTag = stableTagsNewestFirst(listTags(root)).find(
    (tag) => git(root, ["merge-base", "--is-ancestor", tag, "HEAD"]).status === 0,
  );
  const upstreamMain = `${manifest.upstream.remote}/${manifest.upstream.branch}`;
  if (
    baseTag === undefined ||
    git(root, ["rev-parse", "--verify", "--quiet", upstreamMain]).status !== 0
  ) {
    return { baseTag, unreleasedCount: 0 };
  }
  const bases = git(root, ["merge-base", "--all", "HEAD", upstreamMain])
    .stdout.split("\n")
    .filter(Boolean);
  if (bases.length === 0) return { baseTag, unreleasedCount: 0 };
  const count = git(root, ["rev-list", "--count", ...bases, `^${baseTag}`]);
  return { baseTag, unreleasedCount: count.status === 0 ? Number(count.stdout.trim()) : 0 };
};

// Non-fatal observations about the recorded and actual upstream base.
const baseWarningsFor = (ctx: EngineContext): string[] => {
  const warnings: string[] = [];
  const { baseTag, unreleasedCount } = detectBase(ctx);
  if (baseTag !== undefined && unreleasedCount > 0) {
    warnings.push(
      `the fork is on an unreleased upstream base: ${unreleasedCount} upstream commit(s) beyond ${baseTag} (merged from ${ctx.manifest.upstream.remote}/${ctx.manifest.upstream.branch}). ${RELEASE_POLICY_SUMMARY}`,
    );
  }
  const baseFile = ctx.manifest.upstream.baseFile;
  if (baseFile !== undefined) {
    const text = readTextIfExists(ctx.root, baseFile);
    const recorded = text === undefined ? undefined : parseUpstreamBase(text);
    if (recorded === undefined) {
      warnings.push(`${baseFile} is missing or unreadable; the next sync to a release writes it.`);
    } else if (baseTag !== undefined && recorded.tag !== baseTag && unreleasedCount === 0) {
      warnings.push(
        `${baseFile} records ${recorded.tag ?? "an unreleased base"} but history contains ${baseTag}.`,
      );
    }
  }
  return warnings;
};

export const runStatus = (
  ctx: EngineContext,
  options: { readonly fetch: boolean; readonly record?: boolean },
): { exitCode: number } => {
  const { root, manifest, log } = ctx;
  const { remote } = manifest.upstream;
  if (options.fetch) {
    const fetched = git(root, ["fetch", remote, "--tags"]);
    if (fetched.status !== 0) log(`WARNING: git fetch ${remote} --tags failed; using local refs.`);
  }
  const tags = listTags(root);
  const newest = newestStableTag(tags);
  const { baseTag, unreleasedCount } = detectBase(ctx);
  const dateOf = (rev: string) => git(root, ["log", "-1", "--format=%cs", rev]).stdout.trim();
  const recordedText = manifest.upstream.baseFile
    ? readTextIfExists(root, manifest.upstream.baseFile)
    : undefined;
  const recorded = recordedText === undefined ? undefined : parseUpstreamBase(recordedText);

  log(
    `Current base: ${baseTag ?? "unknown (no stable upstream release in history)"}${baseTag ? ` (${dateOf(baseTag)})` : ""}${
      recorded
        ? `; recorded in ${manifest.upstream.baseFile}: ${recorded.tag ?? "unreleased"}, synced ${recorded.synced}`
        : ""
    }`,
  );
  for (const warning of baseWarningsFor(ctx)) log(`WARNING: ${warning}`);
  if (options.record) {
    const file = manifest.upstream.baseFile;
    if (file === undefined || baseTag === undefined || unreleasedCount > 0) {
      log(
        "REFUSED: not recording the base: HEAD must contain a stable upstream release and no unreleased upstream commits.",
      );
      return { exitCode: 1 };
    }
    writeText(
      root,
      file,
      renderUpstreamBase({
        tag: baseTag,
        commit: gitOrThrow(root, ["rev-parse", `${baseTag}^{commit}`]).trim(),
        synced: ctx.today,
      }),
    );
    log(`Recorded ${baseTag} in ${file}. Commit it.`);
  }
  if (newest === undefined) {
    log(`Newest stable upstream release: none found for ${remote}.`);
    return { exitCode: 0 };
  }
  log(`Newest stable upstream release: ${newest} (${dateOf(newest)})`);

  const upToDate = git(root, ["merge-base", "--is-ancestor", newest, "HEAD"]).status === 0;
  if (upToDate) {
    log(`Up to date: HEAD contains ${newest}. Nothing to update to.`);
  } else {
    const from = baseTag ?? git(root, ["merge-base", "HEAD", newest]).stdout.trim();
    const count = gitOrThrow(root, ["rev-list", "--count", `${from}..${newest}`]).trim();
    log(
      `Update available: ${count} upstream commit(s) between ${baseTag ?? short(from)} and ${newest}.`,
    );
    const changes = parseNameStatusZ(
      gitOrThrow(root, ["diff", "--name-status", "-M", "-z", from, newest]),
    );
    const touchpoints = findTouchpoints(manifest, changes);
    log(`  ${changes.length} file(s) changed; ${touchpoints.length} Kodo overlay touchpoint(s):`);
    for (const touchpoint of touchpoints.toSorted((a, b) => a.severity.localeCompare(b.severity))) {
      log(
        `    ${touchpoint.severity === "attention" ? "ATTENTION" : "info     "} ${touchpoint.message}`,
      );
    }
    log("Run `pnpm kodo:sync --dry-run` to size the merge, `pnpm kodo:sync` to start it.");
  }
  const beyond = tags.filter((tag) => isPrereleaseBeyond(tag, newest)).toSorted();
  log(
    beyond.length > 0
      ? `Upstream prereleases beyond ${newest}: ${beyond.length} (latest ${beyond.at(-1)}). Kodo does not track them.`
      : `No upstream prereleases beyond ${newest}.`,
  );
  return { exitCode: 0 };
};
