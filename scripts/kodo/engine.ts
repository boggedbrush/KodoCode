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
  compareTagWithRemote,
  isPrereleaseBeyond,
  newestStableTag,
  parseLsRemoteTags,
  parseUpstreamBase,
  UPSTREAM_TAG_NAMESPACE,
  UPSTREAM_TAG_REFSPEC,
  upstreamTagRef,
  type TagVerification,
  type UpstreamBase,
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
import { findTouchpoints, parseNameStatusZ, type UpstreamChange } from "./touchpoints.ts";
import { findReviewItems, findRunLiteralsWithoutSnapshot } from "./reviewItems.ts";
import { findVerifyCoverage } from "./verifyCoverage.ts";

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

const readBaseFile = (ctx: EngineContext): UpstreamBase | undefined => {
  const file = ctx.manifest.upstream.baseFile;
  const text = file === undefined ? undefined : readTextIfExists(ctx.root, file);
  return text === undefined ? undefined : parseUpstreamBase(text);
};

const commitExists = (root: string, rev: string): boolean =>
  git(root, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]).status === 0;

// The upstream commit the Kodo layer sits on: the recorded base when HEAD contains it, else the
// newest fetched stable release HEAD contains. The layer is the diff from there to HEAD.
export const layerBaseCommit = (ctx: EngineContext): string | undefined => {
  const recorded = readBaseFile(ctx)?.commit;
  if (
    recorded !== undefined &&
    commitExists(ctx.root, recorded) &&
    git(ctx.root, ["merge-base", "--is-ancestor", recorded, "HEAD"]).status === 0
  ) {
    return recorded;
  }
  const tag = detectBase(ctx).baseTag;
  return tag === undefined ? undefined : upstreamTagRef(tag);
};

// What a clean merge could break silently, found in the working tree rather than a range.
const verifyProblems = (
  ctx: EngineContext,
): { readonly problems: string[]; readonly warnings: string[] } => {
  const problems: string[] = [];
  const warnings: string[] = [];
  const base = layerBaseCommit(ctx);
  const io = createFsIo(ctx.root);
  const exists = (path: string) => io.readBytes(path) !== undefined;
  if (base === undefined) {
    warnings.push(
      "cannot tell which test files the Kodo layer touches: no recorded upstream base in HEAD's history. Run `kodo:status` to fetch upstream tags.",
    );
  }
  // The working tree against the base, plus new untracked files, so a test is caught before it is committed.
  const layerFiles =
    base === undefined
      ? []
      : [
          ...gitNulList(ctx.root, ["diff", "--name-only", "--diff-filter=ACMR", "-z", base]),
          ...gitNulList(ctx.root, ["ls-files", "--others", "--exclude-standard", "-z"]),
        ];
  const coverage = findVerifyCoverage(ctx.manifest.verify, layerFiles, exists);
  for (const path of coverage.unverified) {
    problems.push(
      `${path} is a test file the Kodo layer touches but verify.testFiles does not run it. Add it to verify.testFiles (or to verify.testExempt with a reason) in the manifest.`,
    );
  }
  for (const entry of coverage.stale) {
    problems.push(`${entry} does not exist; remove or rename it in the manifest.`);
  }
  const serverFiles = gitNulList(ctx.root, ["ls-files", "-z", "--", "apps/server/src"]).flatMap(
    (path) => {
      const text = path.endsWith(".ts") ? readTextIfExists(ctx.root, path) : undefined;
      return text === undefined ? [] : [{ path, text }];
    },
  );
  for (const site of findRunLiteralsWithoutSnapshot(serverFiles)) {
    warnings.push(
      `needs a human look: ${site} creates a run with no kodoRunModeSnapshot nearby; a run must record the mode it was created in.`,
    );
  }
  return { problems, warnings };
};

export const runCheck = (
  ctx: EngineContext,
  options: { readonly requireRelease?: boolean } = {},
): { report: CheckReport; exitCode: number; problems: ReadonlyArray<string> } => {
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
  const coverage = verifyProblems(ctx);
  for (const problem of coverage.problems) ctx.log(`VERIFY COVERAGE: ${problem}`);
  for (const warning of coverage.warnings) ctx.log(`WARNING: ${warning}`);
  const problems = [...report.problems, ...coverage.problems];
  const releaseFailures =
    options.requireRelease === true ? releaseGateFailures(ctx, baseWarnings) : [];
  for (const failure of releaseFailures) ctx.log(`Release gate: FAIL (${failure})`);
  if (options.requireRelease === true && releaseFailures.length === 0) {
    ctx.log("Release gate: PASS");
  }
  return {
    report,
    problems,
    exitCode: problems.length === 0 && releaseFailures.length === 0 ? 0 : 1,
  };
};

// What `check --release` asserts beyond a plain check: a stable, fully verified upstream base.
const releaseGateFailures = (ctx: EngineContext, baseWarnings: ReadonlyArray<string>): string[] => {
  const failures: string[] = [];
  if (baseWarnings.some((warning) => warning.includes("unreleased upstream base"))) {
    failures.push("the fork is not on a stable upstream release");
  }
  const baseFile = ctx.manifest.upstream.baseFile;
  if (baseFile === undefined) return failures;
  const recorded = readBaseFile(ctx);
  if (recorded === undefined) {
    failures.push(`${baseFile} is missing; run kodo:status --record, then kodo:verify`);
  } else if (recorded.tag === undefined) {
    failures.push(`${baseFile} records an unreleased upstream commit, not a stable release`);
  } else if (recorded.verified === undefined) {
    failures.push(
      `${baseFile} has no verification marker: the sync's check or verification failed or was skipped. Fix it, then run kodo:verify`,
    );
  } else if (
    !commitExists(ctx.root, recorded.verified.commit) ||
    git(ctx.root, ["merge-base", "--is-ancestor", recorded.verified.commit, "HEAD"]).status !== 0
  ) {
    failures.push(
      `the verification marker names ${recorded.verified.commit.slice(0, 10)}, which is not in HEAD's history`,
    );
  } else {
    const changed = gitNulList(ctx.root, [
      "diff",
      "--name-only",
      "-z",
      recorded.verified.commit,
      "HEAD",
    ]).filter((path) => path !== baseFile && path !== ctx.manifest.upstream.logFile);
    if (changed.length > 0) {
      ctx.log(
        `WARNING: ${changed.length} file(s) changed since the last verification (${short(recorded.verified.commit)}); re-run kodo:verify before shipping.`,
      );
    }
  }
  return failures;
};

// Runs check and every verification command on the working tree. Only a full pass writes the
// verification marker into the base file (left uncommitted); any failure removes a stale one.
export const runVerify = (ctx: EngineContext): { exitCode: number } => {
  const log = ctx.log;
  log("Checking the overlay...");
  const check = runCheck(ctx);
  const outcomes = runVerification(ctx);
  const failures = [
    ...(check.exitCode !== 0 ? ["check"] : []),
    ...outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.name),
  ];
  const baseFile = ctx.manifest.upstream.baseFile;
  const recorded = readBaseFile(ctx);
  log("");
  if (failures.length > 0) {
    if (baseFile !== undefined && recorded?.verified !== undefined) {
      writeText(
        ctx.root,
        baseFile,
        renderUpstreamBase({ tag: recorded.tag, commit: recorded.commit, synced: recorded.synced }),
      );
      log(`Removed the stale verification marker from ${baseFile}.`);
    }
    log(`NOT READY: ${failures.join("; ")} failed.`);
    return { exitCode: 1 };
  }
  if (baseFile === undefined || recorded === undefined) {
    log("PASS, but there is no recorded upstream base to mark (run `kodo:status --record` first).");
    return { exitCode: 1 };
  }
  writeText(
    ctx.root,
    baseFile,
    renderUpstreamBase({
      ...recorded,
      verified: {
        date: ctx.today,
        commit: gitOrThrow(ctx.root, ["rev-parse", "HEAD"]).trim(),
      },
    }),
  );
  log(
    `PASS: check and ${outcomes.length} verification command(s). Marked verified in ${baseFile}; commit it.`,
  );
  return { exitCode: 0 };
};

export interface SyncOptions {
  readonly ref?: string;
  // Accept a release tag that could not be checked against the upstream remote (offline use).
  readonly allowUnverified?: boolean;
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
    const failure = fetchUpstream(ctx);
    if (failure !== undefined) {
      const message = `fetching ${remote} failed: ${failure}`;
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
        `REFUSED: no stable release tag (vX.Y.Z) found for ${remote} in ${UPSTREAM_TAG_NAMESPACE}. ${RELEASE_POLICY_MESSAGE}`,
        options.fetch ? "" : "Run without --no-fetch to fetch the tags first.",
      );
    }
    ref = newest;
  } else if (!isStableRelease(root, ref)) {
    const note = `"${ref}" is not a stable upstream release${isStableTag(ref) ? ` (no ${upstreamTagRef(ref)}; a tag of that name in refs/tags is not upstream's)` : ""}. ${RELEASE_POLICY_MESSAGE}`;
    if (!options.dryRun && options.allowUnreleased !== true) return refuse(ctx, `REFUSED: ${note}`);
    log(
      options.dryRun
        ? `NOTE: ${note} (a real sync would refuse it).`
        : `WARNING: syncing to an unreleased ref (--allow-unreleased): ${ref}`,
    );
  }
  const releaseRef = isStableRelease(root, ref);
  if (releaseRef) {
    const verification = verifyUpstreamTag(ctx, ref);
    if (!verification.ok) {
      const note = `${verification.reason} Release tags must match what ${remote} advertises.`;
      if (options.allowUnverified === true) {
        log(`WARNING: tag not verified against ${remote} (--allow-unverified): ${note}`);
      } else if (options.dryRun) {
        log(`NOTE: ${note} (a real sync would refuse it unless --allow-unverified is given).`);
      } else {
        return refuse(
          ctx,
          `REFUSED: ${note}`,
          "Fix the remote or the fetch, or pass --allow-unverified to accept the local tag (offline use).",
        );
      }
    }
  }
  const resolved = git(root, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${releaseRef ? upstreamTagRef(ref) : ref}^{commit}`,
  ]);
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

// Runs every verification command, logging the tail of any failure.
const runVerification = (ctx: EngineContext): VerificationOutcome[] => {
  const outcomes: VerificationOutcome[] = [];
  const exec = ctx.exec ?? ((dir, argv) => runCommand(dir, argv, ctx.shell ?? false));
  for (const command of verificationCommands(ctx.manifest)) {
    ctx.log("");
    ctx.log(`Verifying: ${command.argv.join(" ")}`);
    const result = exec(ctx.root, command.argv);
    outcomes.push({
      name: command.name,
      ok: result.ok,
      detail: result.ok ? "" : `exit ${result.status}`,
    });
    if (!result.ok) {
      for (const line of result.output.trimEnd().split("\n").slice(-30)) ctx.log(`    ${line}`);
    }
  }
  return outcomes;
};

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

  const verification = options.verify ? runVerification(ctx) : [];

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
  const reviewItems = logReviewItems(ctx, state.rangeFrom, state.rangeTo, changedUpstream);

  const failed = check.exitCode !== 0 || verification.some((outcome) => !outcome.ok);
  // The marker `kodo:check --release` requires: written only when nothing failed and nothing was skipped.
  const verifiedCommit = gitOrThrow(root, ["rev-parse", "HEAD"]).trim();
  if (baseFile !== undefined) {
    writeText(
      root,
      baseFile,
      renderUpstreamBase({
        tag: state.releaseTag,
        commit: state.rangeTo,
        synced: ctx.today,
        ...(!failed && options.verify
          ? { verified: { date: ctx.today, commit: verifiedCommit } }
          : {}),
      }),
    );
  }

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
    checkProblems: check.problems,
    verification,
    verificationSkipped: !options.verify,
    reviewItems,
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

  log("");
  if (failed) {
    const reasons = [
      ...(check.exitCode !== 0 ? [`check failed (${check.problems.length} problem line(s))`] : []),
      ...verification.filter((outcome) => !outcome.ok).map((outcome) => `${outcome.name} failed`),
    ];
    log(
      `NOT READY: branch ${state.branch} failed ${reasons.join("; ")}. Do not release or merge it.`,
    );
    log(
      "The merge and overlay commits are on the branch for inspection, and the log entry records the failures. Fix them, then run `kodo:verify`; `kodo:check --release` fails until it passes. Nothing was pushed.",
    );
  } else if (!options.verify) {
    log(
      `NOT READY: branch ${state.branch} was not verified (--no-verify). Run \`kodo:verify\`; \`kodo:check --release\` fails until it passes. Nothing was pushed.`,
    );
  } else {
    log(
      `DONE: branch ${state.branch} passed check and ${verification.length} verification command(s); marked verified. Nothing was pushed.`,
    );
  }
  for (const item of followUps) log(`TODO: ${item}`);
  return {
    status: failed ? "completed-with-failures" : "completed",
    exitCode: failed ? 1 : 0,
    branch: state.branch,
  };
};

const reviewItemsFor = (
  ctx: EngineContext,
  from: string,
  to: string,
  changes: ReadonlyArray<UpstreamChange>,
): ReadonlyArray<string> =>
  findReviewItems({
    manifest: ctx.manifest,
    changes,
    serverDiff: git(ctx.root, ["diff", "-U0", from, to, "--", "apps/server/src"]).stdout,
  }).map((item) => item.message);

const logReviewItems = (
  ctx: EngineContext,
  from: string,
  to: string,
  changes: ReadonlyArray<UpstreamChange>,
): ReadonlyArray<string> => {
  const items = reviewItemsFor(ctx, from, to, changes);
  ctx.log("");
  ctx.log(
    items.length === 0
      ? "Needs a human look: nothing detected (new providers, MCP tools, run-creation sites, hooked enforcement files)."
      : `Needs a human look: ${items.length} item(s) a clean merge can change without a conflict:`,
  );
  for (const item of items) ctx.log(`  REVIEW ${item}`);
  return items;
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
  logReviewItems(ctx, range.rangeFrom, range.rangeTo, changes);
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

// Upstream's tags live in their own namespace; a `vX.Y.Z` in refs/tags is never trusted as a release.
const listTags = (root: string): string[] =>
  gitLines(root, ["for-each-ref", "--format=%(refname)", `${UPSTREAM_TAG_NAMESPACE}/`]).map(
    (name) => name.slice(UPSTREAM_TAG_NAMESPACE.length + 1),
  );

const isStableRelease = (root: string, ref: string): boolean =>
  isStableTag(ref) &&
  git(root, ["show-ref", "--verify", "--quiet", upstreamTagRef(ref)]).status === 0;

// Fetches the remote's branches and, separately, its tags into the upstream namespace
// (forced and pruned, so the namespace mirrors the remote). Returns the failure, if any.
const fetchUpstream = (ctx: EngineContext): string | undefined => {
  const { root, manifest } = ctx;
  const { remote } = manifest.upstream;
  const branches = git(root, ["fetch", "--no-tags", remote]);
  if (branches.status !== 0) return branches.stderr.trim() || "git fetch failed";
  const tags = git(root, ["fetch", "--no-tags", "--prune", remote, UPSTREAM_TAG_REFSPEC]);
  return tags.status === 0 ? undefined : tags.stderr.trim() || "git fetch of tags failed";
};

// The fetched tag must point where the upstream remote says it does right now.
const verifyUpstreamTag = (ctx: EngineContext, tag: string): TagVerification => {
  const { root } = ctx;
  const { remote } = ctx.manifest.upstream;
  const local = git(root, ["rev-parse", "--verify", "--quiet", `${upstreamTagRef(tag)}^{commit}`]);
  const listing = git(root, [
    "ls-remote",
    "--tags",
    remote,
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ]);
  return compareTagWithRemote({
    tag,
    remote,
    localCommit: local.status === 0 ? local.stdout.trim() : undefined,
    remoteTags: listing.status === 0 ? parseLsRemoteTags(listing.stdout) : undefined,
  });
};

export interface BaseInfo {
  // Newest stable release contained in HEAD.
  readonly baseTag: string | undefined;
  // Upstream commits in HEAD beyond that release (a merged main), when upstream main is known.
  readonly unreleasedCount: number;
}

export const detectBase = (ctx: EngineContext): BaseInfo => {
  const { root, manifest } = ctx;
  const baseTag = stableTagsNewestFirst(listTags(root)).find(
    (tag) => git(root, ["merge-base", "--is-ancestor", upstreamTagRef(tag), "HEAD"]).status === 0,
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
  const count = git(root, ["rev-list", "--count", ...bases, `^${upstreamTagRef(baseTag)}`]);
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
    const failure = fetchUpstream(ctx);
    if (failure !== undefined)
      log(`WARNING: fetching ${remote} failed (${failure}); using local refs.`);
  }
  const tags = listTags(root);
  const newest = newestStableTag(tags);
  const { baseTag, unreleasedCount } = detectBase(ctx);
  const dateOf = (tag: string) =>
    git(root, ["log", "-1", "--format=%cs", upstreamTagRef(tag)]).stdout.trim();
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
  if (recorded !== undefined) {
    log(
      recorded.verified
        ? `Verification: check and every verification command passed on ${recorded.verified.date} at ${short(recorded.verified.commit)}.`
        : `Verification: NOT VERIFIED. ${manifest.upstream.baseFile} has no verification marker, so \`kodo:check --release\` fails until \`kodo:verify\` passes.`,
    );
  }
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
        commit: gitOrThrow(root, ["rev-parse", `${upstreamTagRef(baseTag)}^{commit}`]).trim(),
        synced: ctx.today,
      }),
    );
    log(`Recorded ${baseTag} in ${file}. Commit it.`);
  }
  if (newest === undefined) {
    log(`Newest stable upstream release: none found for ${remote}.`);
    return { exitCode: 0 };
  }
  const verification = verifyUpstreamTag(ctx, newest);
  log(
    `Newest stable upstream release: ${newest} (${dateOf(newest)}), ${verification.ok ? `verified against ${remote}` : `NOT VERIFIED: ${verification.reason} A sync would refuse it.`}`,
  );

  const newestRef = upstreamTagRef(newest);
  const upToDate = git(root, ["merge-base", "--is-ancestor", newestRef, "HEAD"]).status === 0;
  if (upToDate) {
    log(`Up to date: HEAD contains ${newest}. Nothing to update to.`);
  } else {
    const from = baseTag
      ? upstreamTagRef(baseTag)
      : git(root, ["merge-base", "HEAD", newestRef]).stdout.trim();
    const count = gitOrThrow(root, ["rev-list", "--count", `${from}..${newestRef}`]).trim();
    log(
      `Update available: ${count} upstream commit(s) between ${baseTag ?? short(from)} and ${newest}.`,
    );
    const changes = parseNameStatusZ(
      gitOrThrow(root, ["diff", "--name-status", "-M", "-z", from, newestRef]),
    );
    const touchpoints = findTouchpoints(manifest, changes);
    log(`  ${changes.length} file(s) changed; ${touchpoints.length} Kodo overlay touchpoint(s):`);
    for (const touchpoint of touchpoints.toSorted((a, b) => a.severity.localeCompare(b.severity))) {
      log(
        `    ${touchpoint.severity === "attention" ? "ATTENTION" : "info     "} ${touchpoint.message}`,
      );
    }
    logReviewItems(ctx, from, newestRef, changes);
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
