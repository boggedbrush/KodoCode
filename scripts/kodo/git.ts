// @effect-diagnostics nodeBuiltinImport:off - synchronous git and file access for a CLI that runs outside any Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { OverlayIo } from "./overlay.ts";

export interface GitResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

// Never prompts, never opens an editor, and reads the same output format everywhere.
const gitEnvironment = (): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_EDITOR: "true",
  GIT_MERGE_AUTOEDIT: "no",
  LC_ALL: "C",
});

export const git = (root: string, args: ReadonlyArray<string>): GitResult => {
  const result = NodeChildProcess.spawnSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    env: gitEnvironment(),
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
};

export class GitCommandError {
  readonly args: ReadonlyArray<string>;
  readonly result: GitResult;
  constructor(args: ReadonlyArray<string>, result: GitResult) {
    this.args = args;
    this.result = result;
  }
  get message(): string {
    return `git ${this.args.join(" ")} failed (exit ${this.result.status}): ${(this.result.stderr || this.result.stdout).trim()}`;
  }
}

// Throws GitCommandError on a non-zero exit; returns stdout otherwise.
export const gitOrThrow = (root: string, args: ReadonlyArray<string>): string => {
  const result = git(root, args);
  if (result.status !== 0) throw new GitCommandError(args, result);
  return result.stdout;
};

export const gitLines = (root: string, args: ReadonlyArray<string>): string[] =>
  gitOrThrow(root, args)
    .split("\n")
    .filter((line) => line !== "");

export const gitNulList = (root: string, args: ReadonlyArray<string>): string[] =>
  gitOrThrow(root, args)
    .split("\0")
    .filter((entry) => entry !== "");

// A file-backed OverlayIo over a git working tree. The listing is every
// tracked or untracked-but-not-ignored file that still exists on disk.
export const createFsIo = (
  root: string,
): OverlayIo & { readonly writtenPaths: () => ReadonlyArray<string> } => {
  const written = new Set<string>();
  let listing: Set<string> | undefined;
  const absolute = (path: string) => NodePath.join(root, ...path.split("/"));
  const files = (): Set<string> => {
    listing ??= new Set(
      gitNulList(root, ["ls-files", "-co", "--exclude-standard", "-z"]).filter((path) => {
        try {
          return NodeFS.statSync(absolute(path)).isFile();
        } catch {
          return false;
        }
      }),
    );
    return listing;
  };
  return {
    listFiles: () => [...files()].toSorted(),
    readBytes: (path) => {
      try {
        return NodeFS.readFileSync(absolute(path));
      } catch {
        return undefined;
      }
    },
    dirExists: (path) => {
      try {
        return NodeFS.statSync(absolute(path)).isDirectory();
      } catch {
        return false;
      }
    },
    write: (path, data) => {
      NodeFS.mkdirSync(NodePath.dirname(absolute(path)), { recursive: true });
      NodeFS.writeFileSync(absolute(path), data);
      written.add(path);
      files().add(path);
    },
    writtenPaths: () => [...written].toSorted(),
  };
};

export const readTextIfExists = (root: string, path: string): string | undefined => {
  try {
    return NodeFS.readFileSync(NodePath.join(root, path), "utf8");
  } catch {
    return undefined;
  }
};

export const writeText = (root: string, path: string, text: string): void => {
  NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(root, path), text);
};

export const removeFileIfExists = (path: string): void => {
  NodeFS.rmSync(path, { force: true });
};

export interface CommandResult {
  readonly ok: boolean;
  readonly status: number;
  readonly output: string;
}

// The repo's own node_modules/.bin comes first so `vp` is the pinned local one, not a global.
const localBinPath = (root: string): string =>
  [NodePath.join(root, "node_modules", ".bin"), process.env.PATH ?? ""].join(NodePath.delimiter);

// Runs a verification command; Windows needs a shell for the vp shim. Output is captured.
export const runCommand = (
  root: string,
  argv: ReadonlyArray<string>,
  shell: boolean,
): CommandResult => {
  const [program, ...args] = argv;
  if (program === undefined) return { ok: false, status: 1, output: "empty command" };
  const result = NodeChildProcess.spawnSync(program, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    shell,
    env: { ...process.env, PATH: localBinPath(root) },
  });
  const status = result.status ?? 1;
  return {
    ok: status === 0,
    status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? String(result.error) : ""}`,
  };
};

export const resolvePath = (root: string, path: string): string => NodePath.resolve(root, path);
