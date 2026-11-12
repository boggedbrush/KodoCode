#!/usr/bin/env node
// Kodo overlay tooling: `apply`, `check` and `sync [--dry-run|--continue]` re-apply the
// Kodo layer over upstream; run them as `pnpm kodo:<command>`.
// See docs/kodo-upstream-sync.md.
import * as NodeURL from "node:url";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { Command, Flag } from "effect/cli";

import {
  type EngineContext,
  runApply,
  runCheck,
  runCodemodAudit,
  runStatus,
  runSync,
  runVerify,
} from "./engine.ts";
import { type KodoManifest, validateManifest } from "./manifest.ts";

const DEFAULT_MANIFEST = "kodo/overlay.manifest.ts";

const manifestFlag = Flag.String("manifest").pipe(
  Flag.withDescription(
    `Overlay manifest, relative to the repo root. Defaults to ${DEFAULT_MANIFEST}.`,
  ),
  Flag.optional,
);

type ManifestLoad =
  | { readonly ok: true; readonly manifest: KodoManifest }
  | { readonly ok: false; readonly problems: ReadonlyArray<string> };

const loadManifest = (absolutePath: string): Promise<ManifestLoad> =>
  import(NodeURL.pathToFileURL(absolutePath).href).then(
    (module: { readonly default?: unknown }): ManifestLoad => {
      const validation = validateManifest(module.default);
      return validation.ok ? validation : { ok: false, problems: validation.problems };
    },
    (error: unknown): ManifestLoad => ({
      ok: false,
      problems: [`Could not load ${absolutePath}: ${String(error)}`],
    }),
  );

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

// Runs `body` with a validated manifest and sets the process exit code from its result.
const withContext = Effect.fn("kodo.withContext")(function* (
  manifestOption: Option.Option<string>,
  body: (ctx: EngineContext) => number,
) {
  const path = yield* Path.Path;
  const root = yield* path.fromFileUrl(new URL("../..", import.meta.url));
  const manifestPath = path.resolve(
    root,
    Option.getOrElse(manifestOption, () => DEFAULT_MANIFEST),
  );
  const loaded = yield* Effect.promise(() => loadManifest(manifestPath));
  if (!loaded.ok) {
    for (const problem of loaded.problems) write(`MANIFEST ERROR: ${problem}`);
    process.exitCode = 2;
    return;
  }
  const today = DateTime.formatIsoDateUtc(yield* DateTime.now);
  const shell = yield* HostProcess.isWindows;
  const exitCode = body({ root, manifest: loaded.manifest, log: write, today, shell });
  if (exitCode !== 0) process.exitCode = exitCode;
});

const applyCommand = Command.make("apply", { manifest: manifestFlag }, ({ manifest }) =>
  withContext(manifest, (ctx) => runApply(ctx).exitCode),
).pipe(
  Command.withDescription(
    "Apply the Kodo overlay to the working tree. Idempotent; reports every entry.",
  ),
);

const checkCommand = Command.make(
  "check",
  {
    manifest: manifestFlag,
    release: Flag.Boolean("release").pipe(
      Flag.withDescription(
        "Release gate: also fail unless the fork is on a stable upstream release and the recorded sync passed check and verification (`kodo:verify`).",
      ),
      Flag.withDefault(false),
    ),
  },
  ({ manifest, release }) =>
    withContext(manifest, (ctx) => runCheck(ctx, { requireRelease: release }).exitCode),
).pipe(
  Command.withDescription(
    "Read-only. Exit non-zero when the overlay is not fully applied, a required hook is missing, or a leak check fails.",
  ),
);

const syncCommand = Command.make(
  "sync",
  {
    manifest: manifestFlag,
    ref: Flag.String("ref").pipe(
      Flag.withDescription(
        "Upstream release tag to merge. Defaults to the newest stable vX.Y.Z tag.",
      ),
      Flag.optional,
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Report what the merge would touch; change nothing."),
      Flag.withDefault(false),
    ),
    resume: Flag.Boolean("continue").pipe(
      Flag.withDescription(
        "Finish a sync that stopped on conflicts once they are resolved and staged.",
      ),
      Flag.withDefault(false),
    ),
    fetch: Flag.Boolean("fetch").pipe(
      Flag.withDescription("Fetch the upstream remote first. Use --no-fetch to work offline."),
      Flag.withDefault(true),
    ),
    allowUnreleased: Flag.Boolean("allow-unreleased").pipe(
      Flag.withDescription(
        "Allow --ref to be a branch, preview, nightly or commit instead of a stable release tag.",
      ),
      Flag.withDefault(false),
    ),
    allowUnverified: Flag.Boolean("allow-unverified").pipe(
      Flag.withDescription(
        "Accept a release tag that could not be checked against the upstream remote (offline use).",
      ),
      Flag.withDefault(false),
    ),
    verify: Flag.Boolean("verify").pipe(
      Flag.withDescription(
        "Run the manifest's verification commands. Use --no-verify to skip them.",
      ),
      Flag.withDefault(true),
    ),
  },
  ({ manifest, ref, dryRun, resume, fetch, allowUnreleased, allowUnverified, verify }) =>
    withContext(
      manifest,
      (ctx) =>
        runSync(ctx, {
          ...(Option.isSome(ref) ? { ref: ref.value } : {}),
          dryRun,
          resume,
          fetch,
          allowUnreleased,
          allowUnverified,
          verify,
        }).exitCode,
    ),
).pipe(
  Command.withDescription(
    "Merge the newest stable upstream release onto a sync/upstream-<release> branch, re-apply the overlay, check, verify and log it. Never pushes.",
  ),
);

const verifyCommand = Command.make("verify", { manifest: manifestFlag }, ({ manifest }) =>
  withContext(manifest, (ctx) => runVerify(ctx).exitCode),
).pipe(
  Command.withDescription(
    "Run check and the manifest's verification commands on the working tree; on a full pass, write the verification marker `kodo:check --release` requires.",
  ),
);

const codemodAuditCommand = Command.make(
  "codemod-audit",
  {
    manifest: manifestFlag,
    ref: Flag.String("ref").pipe(
      Flag.withDescription("Upstream ref to compare against. Defaults to <remote>/<branch>."),
      Flag.optional,
    ),
  },
  ({ manifest, ref }) =>
    withContext(
      manifest,
      (ctx) =>
        runCodemodAudit(
          ctx,
          Option.getOrElse(
            ref,
            () => `${ctx.manifest.upstream.remote}/${ctx.manifest.upstream.branch}`,
          ),
        ).exitCode,
    ),
).pipe(
  Command.withDescription(
    "Read-only. Compare the brand codemod's output on upstream with the working tree, file by file.",
  ),
);

const statusCommand = Command.make(
  "status",
  {
    manifest: manifestFlag,
    record: Flag.Boolean("record").pipe(
      Flag.withDescription(
        "Write the upstream base file from the release found in history. Refused on an unreleased base.",
      ),
      Flag.withDefault(false),
    ),
    fetch: Flag.Boolean("fetch").pipe(
      Flag.withDescription("Fetch upstream tags first. Use --no-fetch to work offline."),
      Flag.withDefault(true),
    ),
  },
  ({ manifest, fetch, record }) =>
    withContext(manifest, (ctx) => runStatus(ctx, { fetch, record }).exitCode),
).pipe(
  Command.withDescription(
    "Read-only. Current upstream base, newest stable release, what an update touches, and prereleases beyond it.",
  ),
);

export const kodoCommand = Command.make("kodo").pipe(
  Command.withDescription("Re-apply, check and sync the Kodo layer over upstream T3 Code."),
  Command.withSubcommands([
    applyCommand,
    checkCommand,
    syncCommand,
    statusCommand,
    verifyCommand,
    codemodAuditCommand,
  ]),
);

if (import.meta.main) {
  Command.run(kodoCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
