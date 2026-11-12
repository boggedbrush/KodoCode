// Shape and validation of the Kodo overlay manifest (kodo/overlay.manifest.ts).
// The manifest is data: every behavior lives in the engine. Shape errors come
// from the Schema; `validateManifest` adds the rules a shape cannot express
// (unique ids, safe paths, a replacement that cannot match its own output).
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { describeBadRelativePath, isGlob } from "./paths.ts";

// An entry carrying `todo` is a placeholder: validated, reported, never applied or enforced.
const Todo = Schema.optionalKey(Schema.String);

const AssetCopy = Schema.Struct({
  id: Schema.NonEmptyString,
  // Kodo-owned source file, copied byte for byte over each destination.
  source: Schema.NonEmptyString,
  destinations: Schema.NonEmptyArray(Schema.NonEmptyString),
  // Destinations must exist upstream by default, so a moved or deleted file is
  // reported. Set true for a Kodo-only file that upstream never had.
  allowCreate: Schema.optionalKey(Schema.Boolean),
  todo: Todo,
});

const Replacement = Schema.Struct({
  id: Schema.NonEmptyString,
  // Exact repo-relative paths or globs (`apps/web/src/**/*.tsx`).
  files: Schema.NonEmptyArray(Schema.NonEmptyString),
  find: Schema.NonEmptyString,
  replace: Schema.String,
  // How many times `find` occurs in upstream's text, summed over all matched
  // files: an exact count, or "at-least-one". A mismatch is reported, not applied.
  expect: Schema.Union([
    Schema.Literal("at-least-one"),
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  ]),
  why: Schema.optionalKey(Schema.String),
  todo: Todo,
});

const JsonEditValue = Schema.Struct({
  // Key path from the document root, e.g. ["build", "appId"] or ["publish", 0, "url"].
  path: Schema.NonEmptyArray(Schema.Union([Schema.String, Schema.Int])),
  value: Schema.Unknown,
  // Insert the key when its parent object exists but the key does not.
  create: Schema.optionalKey(Schema.Boolean),
});

const JsonEdit = Schema.Struct({
  id: Schema.NonEmptyString,
  file: Schema.NonEmptyString,
  set: Schema.NonEmptyArray(JsonEditValue),
  todo: Todo,
});

const RequiredHooks = Schema.Struct({
  file: Schema.NonEmptyString,
  // Text that must follow `KODO:` in the file: a stable hook name (`mode-resolver`) or,
  // for brand edits, the start of the marker's comment (`Kodo app id`).
  hooks: Schema.NonEmptyArray(Schema.NonEmptyString),
  todo: Todo,
});

const KodoOwnedPath = Schema.Struct({
  // A file, a directory (trailing `/`), or a glob.
  path: Schema.NonEmptyString,
  why: Schema.optionalKey(Schema.String),
  // True when upstream legitimately has this path too (README.md): ours still wins on
  // conflict, but sync does not warn that upstream ships it.
  upstreamHasIt: Schema.optionalKey(Schema.Boolean),
  todo: Todo,
});

const LeakPattern = Schema.Union([
  Schema.Struct({ text: Schema.NonEmptyString }),
  Schema.Struct({ regex: Schema.NonEmptyString, flags: Schema.optionalKey(Schema.String) }),
]);

const LeakCheck = Schema.Struct({
  id: Schema.NonEmptyString,
  files: Schema.NonEmptyArray(Schema.NonEmptyString),
  forbid: Schema.NonEmptyArray(LeakPattern),
  // A hit is allowed when it matches an entry: `file` (glob) and `text` (substring
  // of the line) must both match when both are given.
  allow: Schema.Array(
    Schema.Struct({
      file: Schema.optionalKey(Schema.String),
      text: Schema.optionalKey(Schema.String),
      why: Schema.optionalKey(Schema.String),
    }),
  ),
  todo: Todo,
});

const BrandCodemod = Schema.Struct({
  // The upstream product name inside string and template literals ...
  brand: Schema.NonEmptyString,
  // ... becomes `${expression}`, with `import { importName } from "importFrom"` added.
  expression: Schema.NonEmptyString,
  importName: Schema.NonEmptyString,
  importFrom: Schema.NonEmptyString,
  // Files the codemod owns: exact paths or globs, minus `exclude`.
  files: Schema.Array(Schema.NonEmptyString),
  exclude: Schema.Array(Schema.NonEmptyString),
  // Deliberate keeps. `text` is a substring of the literal's source; without it the whole file is kept.
  keep: Schema.Array(
    Schema.Struct({
      file: Schema.NonEmptyString,
      text: Schema.optionalKey(Schema.NonEmptyString),
      why: Schema.NonEmptyString,
    }),
  ),
  todo: Todo,
});

const VerifyCommand = Schema.Struct({
  name: Schema.NonEmptyString,
  argv: Schema.NonEmptyArray(Schema.NonEmptyString),
});

export const KodoManifestSchema = Schema.Struct({
  version: Schema.Literal(1),
  upstream: Schema.Struct({
    // Labels used in the sync log, e.g. "pingdotgg/t3code".
    repo: Schema.NonEmptyString,
    forkRepo: Schema.NonEmptyString,
    remote: Schema.NonEmptyString,
    branch: Schema.NonEmptyString,
    logFile: Schema.NonEmptyString,
    // Where sync records the upstream release this fork is based on.
    baseFile: Schema.optionalKey(Schema.NonEmptyString),
    // Taken from upstream on conflict; the user is told to reinstall.
    lockfiles: Schema.Array(Schema.NonEmptyString),
  }),
  assets: Schema.Array(AssetCopy),
  replacements: Schema.Array(Replacement),
  jsonEdits: Schema.Array(JsonEdit),
  hooks: Schema.Array(RequiredHooks),
  kodoOwned: Schema.Array(KodoOwnedPath),
  leakChecks: Schema.Array(LeakCheck),
  brandCodemod: Schema.optionalKey(BrandCodemod),
  verify: Schema.Struct({
    // Run as `vp test run <files>`. Every test file the Kodo layer adds or edits (the diff from
    // the recorded upstream base to HEAD) must be here or in `testExempt`; `kodo:check` fails
    // otherwise, so a new Kodo test cannot be forgotten.
    testFiles: Schema.Array(Schema.NonEmptyString),
    // Layer test files deliberately left out of the run, each with the reason.
    testExempt: Schema.Array(
      Schema.Struct({ file: Schema.NonEmptyString, why: Schema.NonEmptyString }),
    ),
    // Run as `vp run --filter <package> typecheck`.
    typecheckPackages: Schema.Array(Schema.NonEmptyString),
    commands: Schema.Array(VerifyCommand),
  }),
});

export type KodoManifest = typeof KodoManifestSchema.Type;
export type KodoManifestInput = typeof KodoManifestSchema.Encoded;
export type AssetCopyEntry = KodoManifest["assets"][number];
export type ReplacementEntry = KodoManifest["replacements"][number];
export type JsonEditEntry = KodoManifest["jsonEdits"][number];
export type HookEntry = KodoManifest["hooks"][number];
export type OwnedPathEntry = KodoManifest["kodoOwned"][number];
export type BrandCodemodConfig = NonNullable<KodoManifest["brandCodemod"]>;
export type LeakCheckEntry = KodoManifest["leakChecks"][number];

const decode = Schema.decodeUnknownResult(KodoManifestSchema);

const duplicateIds = (label: string, ids: ReadonlyArray<string>): string[] => {
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) problems.push(`${label} id "${id}" is used more than once.`);
    seen.add(id);
  }
  return problems;
};

const isJsonValue = (value: unknown): boolean => {
  if (value === null || ["string", "boolean"].includes(typeof value)) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === "object") return Object.values(value as object).every(isJsonValue);
  return false;
};

const semanticProblems = (manifest: KodoManifest): string[] => {
  const problems: string[] = [];
  const path = (where: string, value: string, allowGlob: boolean) => {
    const bad = describeBadRelativePath(value);
    if (bad !== undefined) problems.push(`${where}: path "${value}" ${bad}.`);
    else if (!allowGlob && isGlob(value)) {
      problems.push(`${where}: path "${value}" must be an exact file, not a glob.`);
    }
  };

  problems.push(
    ...duplicateIds(
      "assets",
      manifest.assets.map((entry) => entry.id),
    ),
    ...duplicateIds(
      "replacements",
      manifest.replacements.map((entry) => entry.id),
    ),
    ...duplicateIds(
      "jsonEdits",
      manifest.jsonEdits.map((entry) => entry.id),
    ),
    ...duplicateIds(
      "leakChecks",
      manifest.leakChecks.map((entry) => entry.id),
    ),
  );
  path("upstream.logFile", manifest.upstream.logFile, false);
  if (manifest.upstream.baseFile !== undefined) {
    path("upstream.baseFile", manifest.upstream.baseFile, false);
  }
  for (const lockfile of manifest.upstream.lockfiles) path("upstream.lockfiles", lockfile, false);

  for (const entry of manifest.assets) {
    path(`assets "${entry.id}" source`, entry.source, false);
    for (const destination of entry.destinations) {
      path(`assets "${entry.id}" destination`, destination, false);
    }
  }
  for (const entry of manifest.replacements) {
    for (const file of entry.files) path(`replacements "${entry.id}"`, file, true);
    if (entry.replace.includes(entry.find)) {
      problems.push(
        `replacements "${entry.id}": replace text contains the find text, so a second apply would rewrite its own output. Use a more specific find.`,
      );
    }
  }
  for (const entry of manifest.jsonEdits) {
    path(`jsonEdits "${entry.id}"`, entry.file, false);
    for (const edit of entry.set) {
      if (!isJsonValue(edit.value)) {
        problems.push(
          `jsonEdits "${entry.id}": value for ${JSON.stringify(edit.path)} is not JSON-serializable.`,
        );
      }
    }
  }
  for (const entry of manifest.hooks) {
    path(`hooks "${entry.file}"`, entry.file, false);
    for (const hook of entry.hooks) {
      if (hook !== hook.trim() || hook.includes("\n")) {
        problems.push(
          `hooks "${entry.file}": hook "${hook}" must be one line without surrounding whitespace (it is matched as "KODO: ${hook}").`,
        );
      }
    }
  }
  for (const entry of manifest.kodoOwned) path("kodoOwned", entry.path, true);
  for (const check of manifest.leakChecks) {
    for (const file of check.files) path(`leakChecks "${check.id}"`, file, true);
    for (const pattern of check.forbid) {
      if ("regex" in pattern) {
        try {
          RegExp(pattern.regex, pattern.flags);
        } catch (cause) {
          problems.push(
            `leakChecks "${check.id}": regex /${pattern.regex}/ is invalid (${String(cause)}).`,
          );
        }
      }
    }
    for (const allow of check.allow) {
      if (allow.file === undefined && allow.text === undefined) {
        problems.push(`leakChecks "${check.id}": an allow entry needs a file or a text.`);
      }
    }
  }
  const codemod = manifest.brandCodemod;
  if (codemod) {
    for (const file of codemod.files) path("brandCodemod.files", file, true);
    for (const keep of codemod.keep) path("brandCodemod.keep", keep.file, true);
    if (codemod.expression.includes("}") || codemod.expression.includes("`")) {
      problems.push("brandCodemod.expression must be a plain expression such as APP_BASE_NAME.");
    }
  }
  for (const file of manifest.verify.testFiles) path("verify.testFiles", file, false);
  for (const entry of manifest.verify.testExempt) {
    path("verify.testExempt", entry.file, false);
    if (manifest.verify.testFiles.includes(entry.file)) {
      problems.push(`verify.testExempt: ${entry.file} is also in verify.testFiles.`);
    }
  }
  return problems;
};

export type ManifestValidation =
  | { readonly ok: true; readonly manifest: KodoManifest }
  | { readonly ok: false; readonly problems: ReadonlyArray<string> };

export const validateManifest = (input: unknown): ManifestValidation => {
  const decoded = decode(input);
  if (Result.isFailure(decoded)) {
    return { ok: false, problems: [`Manifest shape is invalid: ${decoded.failure.message}`] };
  }
  const problems = semanticProblems(decoded.success);
  return problems.length > 0 ? { ok: false, problems } : { ok: true, manifest: decoded.success };
};

export const isPlaceholder = (entry: { readonly todo?: string }): boolean =>
  entry.todo !== undefined;
