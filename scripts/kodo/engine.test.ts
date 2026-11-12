// @effect-diagnostics nodeBuiltinImport:off - builds throwaway git repositories in the OS temp directory.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, assert, describe, it } from "@effect/vitest";

import {
  type EngineContext,
  findUnlistedMarkerFiles,
  runApply,
  runCheck,
  runStatus,
  runSync,
  type SyncOptions,
} from "./engine.ts";
import { git, gitOrThrow, runCommand } from "./git.ts";
import { makeManifest } from "./testing.ts";

const sandboxes: string[] = [];
afterAll(() => {
  for (const dir of sandboxes) NodeFS.rmSync(dir, { recursive: true, force: true });
});

const write = (root: string, path: string, text: string) => {
  NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(root, path), text);
};
const read = (root: string, path: string) => NodeFS.readFileSync(NodePath.join(root, path), "utf8");
const commitAll = (root: string, message: string) => {
  gitOrThrow(root, ["add", "-A"]);
  gitOrThrow(root, ["commit", "-q", "-m", message]);
};
const configure = (root: string) => {
  gitOrThrow(root, ["config", "user.email", "test@example.com"]);
  gitOrThrow(root, ["config", "user.name", "Test"]);
  gitOrThrow(root, ["config", "commit.gpgsign", "false"]);
};

const MSG_BASE =
  'import { log } from "./log.ts";\n\nexport const failure = "T3 Code failed to start";\n';

const HOOKED_BASE = "export const a = 1;\n// 1\n// 2\n// 3\n// 4\nexport const e = 5;\n";

const manifest = makeManifest({
  upstream: {
    repo: "upstream/app",
    forkRepo: "fork/app",
    remote: "upstream",
    branch: "main",
    logFile: "docs/upstream-sync-log.md",
    baseFile: "kodo/upstream-base.txt",
    lockfiles: ["pnpm-lock.yaml"],
  },
  assets: [{ id: "icon", source: "kodo/assets/icon.txt", destinations: ["assets/icon.txt"] }],
  replacements: [
    {
      id: "title",
      files: ["src/**/*.tsx"],
      find: "T3 Code",
      replace: "Kodo",
      expect: "at-least-one",
    },
  ],
  brandCodemod: {
    brand: "T3 Code",
    expression: "APP_BASE_NAME",
    importName: "APP_BASE_NAME",
    importFrom: "@t3tools/shared/appBrand",
    files: ["src/**/*.ts"],
    exclude: ["**/*.test.ts"],
    keep: [],
  },
  jsonEdits: [{ id: "pkg", file: "package.json", set: [{ path: ["productName"], value: "Kodo" }] }],
  hooks: [{ file: "src/hooked.ts", hooks: ["mode"] }],
  kodoOwned: [{ path: "kodo/" }],
  verify: { testFiles: ["scripts/kodo/x.test.ts"], typecheckPackages: ["pkg-a"], commands: [] },
});

interface Fixture {
  readonly upstream: string;
  readonly fork: string;
  readonly lines: string[];
  readonly executed: string[][];
  readonly ctx: EngineContext;
}

// An "upstream" repo, a fork cloned from it with a Kodo layer on branch `kodo`,
// then `advanceUpstream` adds the commits the sync will merge.
const makeFixture = (
  advanceUpstream: (upstream: string) => void,
  options: { syncManifest?: typeof manifest; extraKodoLayer?: (fork: string) => void } = {},
): Fixture => {
  const sandbox = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kodo-sync-")),
  );
  sandboxes.push(sandbox);
  const upstream = NodePath.join(sandbox, "upstream");
  const fork = NodePath.join(sandbox, "fork");
  NodeFS.mkdirSync(upstream);
  gitOrThrow(upstream, ["init", "-q", "-b", "main"]);
  configure(upstream);
  write(upstream, "package.json", '{\n  "name": "app",\n  "productName": "T3 Code"\n}\n');
  write(upstream, "src/ui.tsx", 'export const title = "T3 Code";\n');
  write(upstream, "src/hooked.ts", HOOKED_BASE);
  write(upstream, "src/msg.ts", MSG_BASE);
  write(upstream, "src/extra.ts", `${MSG_BASE}\n// 1\n// 2\n// 3\n// 4\nexport const tail = 1;\n`);
  write(upstream, "src/legacy.tsx", 'export const legacy = "OldBrand";\n');
  write(upstream, "src/legacy-hook.ts", "export const legacyHook = 1;\n");
  write(upstream, "assets/icon.txt", "T3 ICON\n");
  write(upstream, "pnpm-lock.yaml", "lock: 1\n");
  write(
    upstream,
    "docs/upstream-sync-log.md",
    "# Upstream Sync Log\n\n## 2026-11-12\n\n- old entry\n",
  );
  commitAll(upstream, "base");
  gitOrThrow(upstream, ["tag", "v0.9.0"]);

  gitOrThrow(sandbox, ["clone", "-q", upstream, fork]);
  gitOrThrow(fork, ["remote", "rename", "origin", "upstream"]);
  configure(fork);
  gitOrThrow(fork, ["switch", "-q", "-c", "kodo"]);
  // The Kodo layer: owned files, a hook edit, then the overlay itself.
  write(fork, "kodo/assets/icon.txt", "KODO ICON\n");
  write(fork, "kodo/own.ts", "export const mine = true;\n");
  write(fork, "src/hooked.ts", HOOKED_BASE.replace("e = 5;", "e = 5; // KODO: mode"));
  options.extraKodoLayer?.(fork);
  const lines: string[] = [];
  const executed: string[][] = [];
  const ctx: EngineContext = {
    root: fork,
    manifest,
    log: (line) => lines.push(line),
    today: "2026-12-01",
    exec: (_root, argv) => {
      executed.push([...argv]);
      return { ok: true, status: 0, output: "" };
    },
  };
  runApply(ctx);
  commitAll(fork, "kodo layer");
  lines.length = 0;

  const before = head(upstream);
  advanceUpstream(upstream);
  if (head(upstream) !== before) gitOrThrow(upstream, ["tag", "v1.0.0"]);
  return {
    upstream,
    fork,
    lines,
    executed,
    ctx: { ...ctx, manifest: options.syncManifest ?? manifest },
  };
};

const SYNC: SyncOptions = { dryRun: false, resume: false, fetch: true, verify: true };
const head = (root: string) => gitOrThrow(root, ["rev-parse", "HEAD"]).trim();
const status = (root: string) => gitOrThrow(root, ["status", "--porcelain"]);
const branches = (root: string) =>
  gitOrThrow(root, ["branch", "--format=%(refname:short)"]).trim().split("\n");
const subjects = (root: string, count: number) =>
  gitOrThrow(root, ["log", `-${count}`, "--format=%s"])
    .trim()
    .split("\n");

describe("kodo sync", () => {
  it("merges cleanly, re-applies the overlay, checks, verifies and logs on a new branch", () => {
    const fx = makeFixture((up) => {
      write(up, "src/other.tsx", 'export const other = "T3 Code";\n');
      write(up, "src/hooked.ts", HOOKED_BASE.replace("a = 1", "a = 10"));
      commitAll(up, "upstream change 1");
      write(up, "README.md", "hello\n");
      commitAll(up, "upstream change 2");
    });
    const kodoHead = head(fx.fork);
    const outcome = runSync(fx.ctx, SYNC);
    assert.strictEqual(outcome.status, "completed");
    assert.strictEqual(outcome.exitCode, 0);
    assert.strictEqual(outcome.branch, "sync/upstream-v1.0.0");
    assert.strictEqual(
      gitOrThrow(fx.fork, ["branch", "--show-current"]).trim(),
      "sync/upstream-v1.0.0",
    );
    // Upstream's new file got the replacement; hooks and Kodo edits survived the merge.
    assert.strictEqual(read(fx.fork, "src/other.tsx"), 'export const other = "Kodo";\n');
    assert.include(read(fx.fork, "src/hooked.ts"), "KODO: mode");
    assert.include(read(fx.fork, "src/hooked.ts"), "a = 10");
    assert.strictEqual(status(fx.fork), "");
    // merge commit, overlay commit, log commit, on top of the Kodo layer.
    assert.deepStrictEqual(
      subjects(fx.fork, 3).map((subject) => subject.split(" ")[0]),
      ["docs:", "kodo:", "Merge"],
    );
    assert.strictEqual(gitOrThrow(fx.fork, ["rev-parse", "HEAD~3"]).trim(), kodoHead);
    assert.strictEqual(head(fx.fork) === kodoHead, false);
    // The original branch was not touched and nothing was pushed.
    assert.strictEqual(gitOrThrow(fx.fork, ["rev-parse", "kodo"]).trim(), kodoHead);
    assert.deepStrictEqual(fx.executed, [
      ["vp", "test", "run", "scripts/kodo/x.test.ts"],
      ["vp", "run", "--filter", "pkg-a", "typecheck"],
    ]);
    const log = read(fx.fork, "docs/upstream-sync-log.md");
    assert.isTrue(log.startsWith("# Upstream Sync Log\n\n## 2026-12-01\n"));
    assert.include(log, "2 commits");
    assert.include(log, "- `src/other.tsx`");
    assert.include(log, "- `kodo:check`: pass.");
    assert.include(log, "## 2026-11-12");
    // A second apply and check are no-ops.
    fx.lines.length = 0;
    assert.deepStrictEqual(runApply(fx.ctx).changedFiles, []);
    assert.strictEqual(runCheck(fx.ctx).exitCode, 0);
    assert.strictEqual(status(fx.fork), "");
  });

  it("is a no-op when already up to date", () => {
    const fx = makeFixture(() => {});
    const outcome = runSync(fx.ctx, SYNC);
    assert.strictEqual(outcome.status, "up-to-date");
    assert.strictEqual(outcome.exitCode, 0);
    assert.deepStrictEqual(
      branches(fx.fork).filter((name) => name.startsWith("sync/")),
      [],
    );
  });

  it("refuses a dirty tree before creating a branch", () => {
    const fx = makeFixture((up) => {
      write(up, "README.md", "x\n");
      commitAll(up, "change");
    });
    write(fx.fork, "scratch.txt", "untracked\n");
    const outcome = runSync(fx.ctx, SYNC);
    assert.strictEqual(outcome.status, "refused");
    assert.include(fx.lines.join("\n"), "working tree is not clean");
    assert.deepStrictEqual(branches(fx.fork), ["kodo", "main"]);
  });

  it("auto-resolves a Kodo-owned conflict with ours and warns that upstream ships there", () => {
    const fx = makeFixture((up) => {
      write(up, "kodo/own.ts", "export const mine = false; // upstream\n");
      commitAll(up, "upstream adds a file at a Kodo-owned path");
    });
    const outcome = runSync(fx.ctx, SYNC);
    assert.strictEqual(outcome.status, "completed");
    assert.strictEqual(read(fx.fork, "kodo/own.ts"), "export const mine = true;\n");
    assert.include(fx.lines.join("\n"), "auto-resolved kodo/own.ts: Kodo-owned path (kodo/)");
    assert.include(
      fx.lines.join("\n"),
      "WARNING: upstream now ships kodo/own.ts inside Kodo-owned kodo/",
    );
    assert.include(
      read(fx.fork, "docs/upstream-sync-log.md"),
      "Warning: upstream now ships `kodo/own.ts`",
    );
  });

  it("takes upstream's lockfile and tells the user to reinstall without installing", () => {
    const fx = makeFixture(
      (up) => {
        write(up, "pnpm-lock.yaml", "lock: 3\n");
        commitAll(up, "upstream bumps deps");
      },
      { extraKodoLayer: (fork) => write(fork, "pnpm-lock.yaml", "lock: 2\n") },
    );
    const outcome = runSync(fx.ctx, SYNC);
    assert.strictEqual(outcome.status, "completed");
    assert.strictEqual(read(fx.fork, "pnpm-lock.yaml"), "lock: 3\n");
    assert.include(
      fx.lines.join("\n"),
      "TODO: Dependencies or the lockfile changed upstream. Reinstall",
    );
    assert.include(read(fx.fork, "docs/upstream-sync-log.md"), "### Follow-ups");
    assert.deepStrictEqual(
      fx.executed.filter((argv) => argv.includes("install") || argv[0] === "pnpm"),
      [],
    );
  });

  it("regenerates a conflicted asset destination from the Kodo source", () => {
    const fx = makeFixture(
      (up) => {
        write(up, "assets/icon.txt", "NEW UPSTREAM ICON\n");
        commitAll(up, "upstream redraws the icon");
      },
      { extraKodoLayer: () => {} },
    );
    const outcome = runSync(fx.ctx, SYNC);
    assert.strictEqual(outcome.status, "completed");
    assert.strictEqual(read(fx.fork, "assets/icon.txt"), "KODO ICON\n");
    assert.include(
      fx.lines.join("\n"),
      'auto-resolved assets/icon.txt: asset destination of "icon"',
    );
  });

  it("stops on a foreign conflict, commits nothing, and resumes after the human resolves it", () => {
    const fx = makeFixture((up) => {
      write(up, "src/hooked.ts", HOOKED_BASE.replace("e = 5;", "e = 6;"));
      commitAll(up, "upstream edits the hooked line");
      write(up, "kodo/own.ts", "export const mine = false;\n");
      commitAll(up, "upstream also touches a Kodo-owned file");
    });
    const kodoHead = head(fx.fork);
    const outcome = runSync(fx.ctx, SYNC);
    assert.strictEqual(outcome.status, "stopped-for-conflicts");
    assert.strictEqual(outcome.exitCode, 1);
    assert.deepStrictEqual(outcome.conflicts, ["src/hooked.ts"]);
    const output = fx.lines.join("\n");
    assert.include(
      output,
      "STOPPED: 1 conflict(s) need a human or agent. Nothing has been committed.",
    );
    assert.include(output, "CONFLICT src/hooked.ts: both sides modified it");
    assert.include(output, "hint: keep Kodo hooks: KODO: mode");
    assert.include(output, "auto-resolved kodo/own.ts");
    // Nothing committed; conflict markers are left in place for the human.
    assert.strictEqual(head(fx.fork), kodoHead);
    assert.include(read(fx.fork, "src/hooked.ts"), "<<<<<<<");
    assert.strictEqual(git(fx.fork, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).status, 0);

    // Resuming before resolving is refused...
    fx.lines.length = 0;
    const early = runSync(fx.ctx, { ...SYNC, resume: true });
    assert.strictEqual(early.status, "refused");
    assert.include(fx.lines.join("\n"), "still unmerged");
    // ...and so is staging a file that still has conflict markers.
    gitOrThrow(fx.fork, ["add", "src/hooked.ts"]);
    fx.lines.length = 0;
    const marked = runSync(fx.ctx, { ...SYNC, resume: true });
    assert.strictEqual(marked.status, "refused");
    assert.include(fx.lines.join("\n"), "conflict markers");
    assert.strictEqual(head(fx.fork), kodoHead);

    // A human resolves it, keeping the hook.
    write(fx.fork, "src/hooked.ts", HOOKED_BASE.replace("e = 5;", "e = 6; // KODO: mode"));
    gitOrThrow(fx.fork, ["add", "src/hooked.ts"]);
    fx.lines.length = 0;
    const resumed = runSync(fx.ctx, { ...SYNC, resume: true });
    assert.strictEqual(resumed.status, "completed");
    assert.strictEqual(status(fx.fork), "");
    const log = read(fx.fork, "docs/upstream-sync-log.md");
    assert.include(log, "### Resolved by hand\n\n- `src/hooked.ts`");
    assert.include(log, "- `kodo/own.ts`: Kodo-owned path");
  });

  it("reports vanished replacement targets and deleted hooked files by manifest entry", () => {
    const fx = makeFixture(
      (up) => {
        gitOrThrow(up, ["rm", "-q", "src/legacy.tsx", "src/legacy-hook.ts"]);
        gitOrThrow(up, ["commit", "-q", "-m", "upstream deletes legacy files"]);
      },
      {
        syncManifest: makeManifest({
          replacements: [
            {
              id: "legacy-title",
              files: ["src/legacy.tsx"],
              find: "OldBrand",
              replace: "Kodo",
              expect: "at-least-one",
            },
          ],
          hooks: [{ file: "src/legacy-hook.ts", hooks: ["legacy-mode"] }],
          verify: { testFiles: [], typecheckPackages: [], commands: [] },
        }),
      },
    );
    // The Kodo layer never touched these files, so upstream's deletion merges cleanly.
    const outcome = runSync(fx.ctx, { ...SYNC, verify: false });
    assert.strictEqual(outcome.status, "completed-with-failures");
    assert.strictEqual(outcome.exitCode, 1);
    const output = fx.lines.join("\n");
    assert.include(output, 'replacements "legacy-title": no file matches "src/legacy.tsx"');
    assert.include(output, "hooks: src/legacy-hook.ts does not exist");
    const log = read(fx.fork, "docs/upstream-sync-log.md");
    assert.include(log, "FAIL (2 problems)");
    assert.include(log, "Unresolved overlay entries:");
    // The tree is still committed without conflict markers.
    assert.strictEqual(status(fx.fork), "");
  });
});

describe("kodo sync --dry-run", () => {
  it("reports touchpoints and conflicts without changing anything", () => {
    const fx = makeFixture((up) => {
      write(up, "src/hooked.ts", HOOKED_BASE.replace("e = 5;", "e = 6;"));
      write(up, "src/ui.tsx", 'export const title = "T3 Code!";\n');
      write(up, "pnpm-lock.yaml", "lock: 9\n");
      write(up, "kodo/new.ts", "export {};\n");
      commitAll(up, "upstream change");
    });
    const before = {
      head: head(fx.fork),
      branches: branches(fx.fork),
      tree: read(fx.fork, "src/ui.tsx"),
    };
    const outcome = runSync(fx.ctx, { ...SYNC, dryRun: true });
    assert.strictEqual(outcome.status, "dry-run");
    assert.strictEqual(outcome.exitCode, 0);
    const output = fx.lines.join("\n");
    assert.include(output, "1 commit(s), 4 file(s) changed upstream");
    assert.include(output, "MANUAL src/hooked.ts: both sides modified it");
    assert.include(
      output,
      'replacements "title": replacement target src/ui.tsx was changed upstream',
    );
    assert.include(output, "lockfile pnpm-lock.yaml was changed upstream");
    assert.include(output, "WARNING: upstream ships kodo/new.ts inside Kodo-owned kodo/");
    assert.strictEqual(head(fx.fork), before.head);
    assert.deepStrictEqual(branches(fx.fork), before.branches);
    assert.strictEqual(read(fx.fork, "src/ui.tsx"), before.tree);
    assert.strictEqual(status(fx.fork), "");
    assert.strictEqual(git(fx.fork, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).status, 1);
  });

  it("works on a dirty tree because it writes nothing", () => {
    const fx = makeFixture((up) => {
      write(up, "README.md", "x\n");
      commitAll(up, "change");
    });
    write(fx.fork, "scratch.txt", "untracked\n");
    assert.strictEqual(runSync(fx.ctx, { ...SYNC, dryRun: true }).status, "dry-run");
  });
});

describe("kodo check", () => {
  it("fails on a tree where upstream text came back, and apply then repairs it", () => {
    const fx = makeFixture(() => {});
    write(fx.fork, "src/ui.tsx", 'export const title = "T3 Code";\n');
    const failing = runCheck(fx.ctx);
    assert.strictEqual(failing.exitCode, 1);
    assert.include(fx.lines.join("\n"), 'replacement "title" is not applied');
    assert.strictEqual(read(fx.fork, "src/ui.tsx"), 'export const title = "T3 Code";\n');
    assert.strictEqual(runApply(fx.ctx).exitCode, 0);
    assert.strictEqual(runCheck(fx.ctx).exitCode, 0);
  });

  it("apply restores what it can and still reports a deleted hook marker", () => {
    const fx = makeFixture(() => {});
    write(fx.fork, "src/ui.tsx", 'export const title = "T3 Code";\n');
    write(fx.fork, "src/hooked.ts", HOOKED_BASE);
    fx.lines.length = 0;
    const outcome = runApply(fx.ctx);
    assert.strictEqual(outcome.exitCode, 1);
    assert.strictEqual(read(fx.fork, "src/ui.tsx"), 'export const title = "Kodo";\n');
    assert.include(fx.lines.join("\n"), 'lost "KODO: mode"');
  });
});

describe("kodo check markers", () => {
  it("warns about KODO markers in files the manifest does not list, without failing", () => {
    const fx = makeFixture(() => {});
    write(fx.fork, "src/new-hook.ts", "export const x = 1; // KODO: brand-new\n");
    assert.deepStrictEqual(findUnlistedMarkerFiles(fx.ctx), ["src/new-hook.ts"]);
    assert.strictEqual(runCheck(fx.ctx).exitCode, 0);
    assert.include(fx.lines.join("\n"), "src/new-hook.ts");
    // Listed hooks files and Kodo-owned paths are accounted for.
    write(fx.fork, "kodo/note.ts", "// KODO: mine\n");
    assert.deepStrictEqual(findUnlistedMarkerFiles(fx.ctx), ["src/new-hook.ts"]);
  });
});

describe("runCommand", () => {
  it("resolves programs from the repo's own node_modules/.bin first", () => {
    const sandbox = NodeFS.realpathSync(
      NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kodo-bin-")),
    );
    sandboxes.push(sandbox);
    write(sandbox, "node_modules/.bin/kodo-probe", "#!/bin/sh\necho local-probe\n");
    NodeFS.chmodSync(NodePath.join(sandbox, "node_modules/.bin/kodo-probe"), 0o755);
    const result = runCommand(sandbox, ["kodo-probe"], false);
    assert.strictEqual(result.ok, true);
    assert.include(result.output, "local-probe");
  });
});

describe("kodo sync with the brand codemod", () => {
  it("converts reworded and new branded messages without a human conflict", () => {
    const fx = makeFixture((up) => {
      write(up, "src/msg.ts", MSG_BASE.replace("failed to start", "could not start"));
      write(up, "src/fresh.ts", 'export const hello = "Welcome to T3 Code";\n');
      commitAll(up, "upstream rewords a converted message and adds a branded one");
    });
    assert.include(read(fx.fork, "src/msg.ts"), "`${APP_BASE_NAME} failed to start`");
    const outcome = runSync(fx.ctx, { ...SYNC, verify: false });
    assert.strictEqual(outcome.status, "completed");
    assert.strictEqual(outcome.exitCode, 0);
    const msg = read(fx.fork, "src/msg.ts");
    assert.include(msg, "`${APP_BASE_NAME} could not start`");
    assert.include(msg, 'import { APP_BASE_NAME } from "@t3tools/shared/appBrand";');
    assert.strictEqual(msg.includes("T3 Code"), false);
    assert.include(read(fx.fork, "src/fresh.ts"), "`Welcome to ${APP_BASE_NAME}`");
    assert.include(fx.lines.join("\n"), "codemod-owned");
    const log = read(fx.fork, "docs/upstream-sync-log.md");
    assert.include(log, "- `src/msg.ts`: codemod-owned");
    assert.include(log, "- `src/fresh.ts`");
    assert.strictEqual(runCheck(fx.ctx).exitCode, 0);
    assert.strictEqual(status(fx.fork), "");
  });

  it("leaves a file with extra Kodo edits to a human", () => {
    const fx = makeFixture(
      (up) => {
        write(
          up,
          "src/extra.ts",
          read(up, "src/extra.ts").replace("failed to start", "could not start"),
        );
        commitAll(up, "upstream rewords a message");
      },
      {
        extraKodoLayer: (fork) => {
          write(fork, "src/extra.ts", read(fork, "src/extra.ts").replace("tail = 1", "tail = 2"));
        },
      },
    );
    const outcome = runSync(fx.ctx, { ...SYNC, verify: false });
    assert.strictEqual(outcome.status, "stopped-for-conflicts");
    assert.deepStrictEqual(outcome.conflicts, ["src/extra.ts"]);
    assert.include(fx.lines.join("\n"), "in brand codemod scope");
  });
});

describe("kodo release policy", () => {
  const commitUpstream = (upstream: string, file: string, message: string, tag?: string) => {
    write(upstream, file, `${message}\n`);
    commitAll(upstream, message);
    if (tag) gitOrThrow(upstream, ["tag", tag]);
  };
  const touchUpstream = (up: string) => commitUpstream(up, "README.md", "release one");

  it("targets the newest stable tag by default, ignoring previews", () => {
    const fx = makeFixture((up) => commitUpstream(up, "a.txt", "release one"));
    commitUpstream(fx.upstream, "b.txt", "later preview", "v1.1.0-preview.20261201.1");
    const outcome = runSync(fx.ctx, SYNC);
    assert.strictEqual(outcome.status, "completed");
    assert.strictEqual(outcome.branch, "sync/upstream-v1.0.0");
    assert.strictEqual(NodeFS.existsSync(NodePath.join(fx.fork, "b.txt")), false);
    assert.include(subjects(fx.fork, 1)[0] ?? "", "docs: record upstream sync v1.0.0");
  });

  it("writes the base file and a release-named log entry", () => {
    const fx = makeFixture(touchUpstream);
    runSync(fx.ctx, SYNC);
    const base = read(fx.fork, "kodo/upstream-base.txt");
    assert.include(base, "tag: v1.0.0\n");
    assert.include(base, `commit: ${gitOrThrow(fx.upstream, ["rev-parse", "v1.0.0"]).trim()}`);
    assert.include(base, "synced: 2026-12-01");
    assert.include(read(fx.fork, "docs/upstream-sync-log.md"), "(v1.0.0)");
  });

  it("reports already on the latest stable release and changes nothing", () => {
    const fx = makeFixture(() => {});
    const outcome = runSync(fx.ctx, SYNC);
    assert.strictEqual(outcome.status, "up-to-date");
    assert.include(fx.lines.join("\n"), "Already on the latest stable release v0.9.0");
    assert.deepStrictEqual(branches(fx.fork), ["kodo", "main"]);
  });

  it("refuses when upstream has no stable tag", () => {
    const fx = makeFixture(touchUpstream);
    gitOrThrow(fx.upstream, ["tag", "-d", "v0.9.0", "v1.0.0"]);
    gitOrThrow(fx.fork, ["tag", "-d", "v0.9.0"]);
    const outcome = runSync(fx.ctx, { ...SYNC, fetch: true });
    assert.strictEqual(outcome.status, "refused");
    assert.include(fx.lines.join("\n"), "no stable release tag");
  });

  it("refuses a branch, a preview tag and a raw commit unless overridden", () => {
    const fx = makeFixture((up) => commitUpstream(up, "a.txt", "release one"));
    commitUpstream(fx.upstream, "b.txt", "beyond the release", "v1.1.0-preview.20261201.1");
    const tip = gitOrThrow(fx.upstream, ["rev-parse", "HEAD"]).trim();
    for (const ref of ["upstream/main", "v1.1.0-preview.20261201.1", tip]) {
      fx.lines.length = 0;
      const outcome = runSync(fx.ctx, { ...SYNC, ref });
      assert.strictEqual(outcome.status, "refused", ref);
      assert.include(fx.lines.join("\n"), "not a stable upstream release");
      assert.include(fx.lines.join("\n"), "--allow-unreleased");
      assert.deepStrictEqual(branches(fx.fork), ["kodo", "main"]);
    }
    const allowed = runSync(fx.ctx, { ...SYNC, ref: "upstream/main", allowUnreleased: true });
    assert.strictEqual(allowed.status, "completed");
    assert.strictEqual(allowed.branch, "sync/upstream-2026-12-01");
    assert.include(
      read(fx.fork, "kodo/upstream-base.txt"),
      "tag: none (unreleased upstream commit)",
    );
  });

  it("accepts an explicit stable tag, and a dry run may always report", () => {
    const fx = makeFixture((up) => commitUpstream(up, "a.txt", "release one"));
    const dry = runSync(fx.ctx, { ...SYNC, ref: "upstream/main", dryRun: true });
    assert.strictEqual(dry.status, "dry-run");
    assert.include(fx.lines.join("\n"), "a real sync would refuse it");
    assert.strictEqual(runSync(fx.ctx, { ...SYNC, ref: "v1.0.0" }).status, "completed");
  });

  it("syncs from one release to the next and updates the base file and log", () => {
    const fx = makeFixture((up) => commitUpstream(up, "a.txt", "release one"));
    assert.strictEqual(runSync(fx.ctx, SYNC).status, "completed");
    commitUpstream(fx.upstream, "c.txt", "release two", "v1.1.0");
    fx.lines.length = 0;
    const second = runSync(fx.ctx, SYNC);
    assert.strictEqual(second.status, "completed");
    assert.strictEqual(second.branch, "sync/upstream-v1.1.0");
    assert.include(read(fx.fork, "kodo/upstream-base.txt"), "tag: v1.1.0\n");
    const log = read(fx.fork, "docs/upstream-sync-log.md");
    assert.isTrue(log.indexOf("(v1.1.0)") < log.indexOf("(v1.0.0)"));
    assert.strictEqual(read(fx.fork, "c.txt"), "release two\n");
    assert.strictEqual(runSync(fx.ctx, SYNC).status, "up-to-date");
  });

  it("warns, without failing, when history holds upstream commits beyond the release", () => {
    const fx = makeFixture((up) => commitUpstream(up, "a.txt", "release one"));
    commitUpstream(fx.upstream, "b.txt", "main moves on");
    commitUpstream(fx.upstream, "c.txt", "and on");
    assert.strictEqual(
      runSync(fx.ctx, { ...SYNC, ref: "upstream/main", allowUnreleased: true }).status,
      "completed",
    );
    fx.lines.length = 0;
    assert.strictEqual(runCheck(fx.ctx).exitCode, 0);
    assert.include(
      fx.lines.join("\n"),
      "unreleased upstream base: 2 upstream commit(s) beyond v1.0.0",
    );
    assert.strictEqual(runCheck(fx.ctx, { requireRelease: true }).exitCode, 1);
  });

  it("is quiet on a release base", () => {
    const fx = makeFixture((up) => commitUpstream(up, "a.txt", "release one"));
    runSync(fx.ctx, SYNC);
    fx.lines.length = 0;
    assert.strictEqual(runCheck(fx.ctx, { requireRelease: true }).exitCode, 0);
    assert.strictEqual(fx.lines.join("\n").includes("unreleased upstream base"), false);
  });

  it("status says what to update to, what it touches, and prereleases beyond", () => {
    const fx = makeFixture((up) => {
      write(up, "src/hooked.ts", HOOKED_BASE.replace("a = 1", "a = 10"));
      commitAll(up, "touch a hooked file");
    });
    commitUpstream(fx.upstream, "z.txt", "preview beyond", "v1.1.0-preview.20261201.1");
    fx.lines.length = 0;
    assert.strictEqual(runStatus(fx.ctx, { fetch: true }).exitCode, 0);
    const out = fx.lines.join("\n");
    assert.include(out, "Current base: v0.9.0");
    assert.include(out, "Newest stable upstream release: v1.0.0");
    assert.include(out, "Update available: 1 upstream commit(s) between v0.9.0 and v1.0.0");
    assert.include(out, "hooks src/hooked.ts: hooked file src/hooked.ts was changed upstream");
    assert.include(out, "Upstream prereleases beyond v1.0.0: 1 (latest v1.1.0-preview.20261201.1)");
    runSync(fx.ctx, SYNC);
    fx.lines.length = 0;
    runStatus(fx.ctx, { fetch: true });
    assert.include(fx.lines.join("\n"), "Up to date: HEAD contains v1.0.0");
  });

  it("status --record writes the base only on a release base", () => {
    const unreleased = makeFixture((up) => commitUpstream(up, "a.txt", "release one"));
    commitUpstream(unreleased.upstream, "b.txt", "beyond");
    runSync(unreleased.ctx, { ...SYNC, ref: "upstream/main", allowUnreleased: true });
    assert.strictEqual(runStatus(unreleased.ctx, { fetch: false, record: true }).exitCode, 1);

    const released = makeFixture(() => {});
    assert.strictEqual(runStatus(released.ctx, { fetch: false, record: true }).exitCode, 0);
    assert.include(read(released.fork, "kodo/upstream-base.txt"), "tag: v0.9.0\n");
  });
});
