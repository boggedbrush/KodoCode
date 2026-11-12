// The overlay engine's pure core: given a manifest and a view of the working
// tree, decide (and optionally perform) each entry and report why. All file
// access goes through OverlayIo so unit tests run against an in-memory tree.
import {
  type AssetCopyEntry,
  type HookEntry,
  type JsonEditEntry,
  isPlaceholder,
  type KodoManifest,
  type LeakCheckEntry,
  type OwnedPathEntry,
  type ReplacementEntry,
} from "./manifest.ts";
import { evaluateBrandCodemod } from "./brandCodemodRun.ts";
import { formatJsonPath, setJsonPath } from "./jsonEdit.ts";
import { isGlob, matchesAnyGlob, matchesGlob, matchesOwnedPath } from "./paths.ts";

export interface OverlayIo {
  // Every non-ignored file in the working tree, repo-relative.
  readonly listFiles: () => ReadonlyArray<string>;
  readonly readBytes: (path: string) => Uint8Array | undefined;
  readonly dirExists: (path: string) => boolean;
  readonly write: (path: string, data: string | Uint8Array) => void;
}

export type EntryStatus =
  // The entry was written (apply) ...
  | "applied"
  // ... or would be written (check).
  | "pending"
  | "already-applied"
  // The thing the entry points at is gone: upstream moved, renamed or rewrote it.
  | "target-missing"
  // The target exists but not in the asserted shape (wrong occurrence count, unparsable JSON).
  | "mismatch"
  // The Kodo-owned source of an asset copy is missing.
  | "source-missing"
  | "placeholder";

export type OverlaySection = "asset" | "replacement" | "jsonEdit" | "codemod";

export interface EntryResult {
  readonly section: OverlaySection;
  readonly id: string;
  readonly status: EntryStatus;
  // Specific, actionable lines naming the manifest entry.
  readonly details: ReadonlyArray<string>;
}

// Statuses that make `check` fail and make `apply` exit non-zero.
export const isFailingStatus = (status: EntryStatus): boolean =>
  status === "pending" ||
  status === "target-missing" ||
  status === "mismatch" ||
  status === "source-missing";

// The unresolved statuses `apply` still has to surface after writing.
export const isUnresolvedStatus = (status: EntryStatus): boolean =>
  status === "target-missing" || status === "mismatch" || status === "source-missing";

const decoder = new TextDecoder();
const readText = (io: OverlayIo, path: string): string | undefined => {
  const bytes = io.readBytes(path);
  return bytes === undefined ? undefined : decoder.decode(bytes);
};

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

const parentDirectory = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")));

const countOccurrences = (text: string, needle: string): number => text.split(needle).length - 1;

const PRIORITY: ReadonlyArray<EntryStatus> = [
  "source-missing",
  "target-missing",
  "mismatch",
  "applied",
  "pending",
  "already-applied",
];
const worst = (statuses: ReadonlyArray<EntryStatus>): EntryStatus =>
  PRIORITY.find((status) => statuses.includes(status)) ?? "already-applied";

const placeholderResult = (section: OverlaySection, id: string, todo: string): EntryResult => ({
  section,
  id,
  status: "placeholder",
  details: [`TODO placeholder, not enforced: ${todo}`],
});

const writtenStatus = (write: boolean): EntryStatus => (write ? "applied" : "pending");

const evaluateAsset = (entry: AssetCopyEntry, io: OverlayIo, write: boolean): EntryResult => {
  if (isPlaceholder(entry)) return placeholderResult("asset", entry.id, entry.todo ?? "");
  const source = io.readBytes(entry.source);
  if (source === undefined) {
    return {
      section: "asset",
      id: entry.id,
      status: "source-missing",
      details: [
        `assets "${entry.id}": Kodo source ${entry.source} does not exist. Restore it or fix the manifest entry.`,
      ],
    };
  }
  const statuses: EntryStatus[] = [];
  const details: string[] = [];
  for (const destination of entry.destinations) {
    const current = io.readBytes(destination);
    if (current === undefined) {
      const directory = parentDirectory(destination);
      if (directory !== "" && !io.dirExists(directory)) {
        statuses.push("target-missing");
        details.push(
          `assets "${entry.id}": destination directory ${directory}/ no longer exists, so ${destination} cannot be written. Upstream probably moved or removed it: find the new location and update the destination.`,
        );
        continue;
      }
      if (!entry.allowCreate) {
        statuses.push("target-missing");
        details.push(
          `assets "${entry.id}": destination ${destination} is missing although ${directory || "the repo root"}/ exists. Upstream probably renamed or removed it: update the destination, or set allowCreate if this is a Kodo-only file.`,
        );
        continue;
      }
    } else if (bytesEqual(current, source)) {
      statuses.push("already-applied");
      continue;
    }
    if (write) io.write(destination, source);
    statuses.push(writtenStatus(write));
    details.push(`${destination} ${write ? "written from" : "differs from"} ${entry.source}`);
  }
  return { section: "asset", id: entry.id, status: worst(statuses), details };
};

const resolveTargets = (
  patterns: ReadonlyArray<string>,
  io: OverlayIo,
): { files: string[]; unmatched: string[] } => {
  const all = io.listFiles();
  const files = new Set<string>();
  const unmatched: string[] = [];
  for (const pattern of patterns) {
    const matched = isGlob(pattern)
      ? all.filter((file) => matchesGlob(file, pattern))
      : all.includes(pattern)
        ? [pattern]
        : [];
    if (matched.length === 0) unmatched.push(pattern);
    for (const file of matched) files.add(file);
  }
  return { files: [...files].toSorted(), unmatched };
};

const evaluateReplacement = (
  entry: ReplacementEntry,
  io: OverlayIo,
  write: boolean,
): EntryResult => {
  if (isPlaceholder(entry)) return placeholderResult("replacement", entry.id, entry.todo ?? "");
  const fail = (status: EntryStatus, ...details: string[]): EntryResult => ({
    section: "replacement",
    id: entry.id,
    status,
    details,
  });
  const { files, unmatched } = resolveTargets(entry.files, io);
  if (unmatched.length > 0) {
    return fail(
      "target-missing",
      `replacements "${entry.id}": no file matches ${unmatched.map((pattern) => `"${pattern}"`).join(", ")}. Upstream probably deleted or renamed it: update the entry's files. (Nothing was changed for this entry.)`,
    );
  }
  const texts = new Map<string, string>();
  let findTotal = 0;
  let replaceTotal = 0;
  for (const file of files) {
    const text = readText(io, file) ?? "";
    texts.set(file, text);
    findTotal += countOccurrences(text, entry.find);
    if (entry.replace !== "") replaceTotal += countOccurrences(text, entry.replace);
  }
  const quoted = JSON.stringify(entry.find);
  const expected = entry.expect === "at-least-one" ? "at least one" : String(entry.expect);

  if (findTotal === 0) {
    const needed = entry.expect === "at-least-one" ? 1 : entry.expect;
    if (replaceTotal >= needed && entry.replace !== "") {
      return fail("already-applied");
    }
    if (replaceTotal > 0 && entry.replace !== "") {
      return fail(
        "mismatch",
        `replacements "${entry.id}": the replacement text appears ${replaceTotal} time(s) but ${expected} were expected and ${quoted} is gone. Upstream removed an occurrence: review the entry's expect.`,
      );
    }
    if (entry.replace === "" && entry.expect !== "at-least-one") {
      return fail("already-applied");
    }
    return fail(
      "target-missing",
      `replacements "${entry.id}": ${quoted} was not found in ${files.length} file(s) (${files.slice(0, 3).join(", ")}${files.length > 3 ? ", ..." : ""}) and the replacement is not present either. Upstream changed or removed the text: update "find" in the manifest.`,
    );
  }
  if (entry.expect !== "at-least-one" && findTotal !== entry.expect) {
    return fail(
      "mismatch",
      `replacements "${entry.id}": found ${quoted} ${findTotal} time(s) but expected ${expected}. Upstream added or removed occurrences: review them, then update expect. (Nothing was changed for this entry.)`,
    );
  }
  const changed: string[] = [];
  for (const [file, text] of texts) {
    if (!text.includes(entry.find)) continue;
    changed.push(file);
    if (write) io.write(file, text.split(entry.find).join(entry.replace));
  }
  return fail(
    writtenStatus(write),
    `${findTotal} occurrence(s) in ${changed.length} file(s): ${changed.join(", ")}`,
  );
};

const evaluateJsonEdit = (entry: JsonEditEntry, io: OverlayIo, write: boolean): EntryResult => {
  if (isPlaceholder(entry)) return placeholderResult("jsonEdit", entry.id, entry.todo ?? "");
  const fail = (status: EntryStatus, ...details: string[]): EntryResult => ({
    section: "jsonEdit",
    id: entry.id,
    status,
    details,
  });
  const original = readText(io, entry.file);
  if (original === undefined) {
    return fail(
      "target-missing",
      `jsonEdits "${entry.id}": ${entry.file} does not exist. Upstream probably moved or deleted it: update the entry's file.`,
    );
  }
  let text = original;
  const statuses: EntryStatus[] = [];
  const details: string[] = [];
  for (const edit of entry.set) {
    const where = formatJsonPath(edit.path);
    const result = setJsonPath(text, edit.path, edit.value, {
      create: edit.create === true,
    });
    if (result.kind === "invalid") {
      return fail(
        "mismatch",
        `jsonEdits "${entry.id}": ${entry.file} is not parseable JSON (${result.message}); resolve the file first.`,
      );
    }
    if (result.kind === "missing") {
      statuses.push("target-missing");
      details.push(
        `jsonEdits "${entry.id}": key path ${formatJsonPath(result.missingAt)} does not exist in ${entry.file}. Upstream restructured it: update the path, or set create to insert the key. (Nothing was changed for this entry.)`,
      );
    } else if (result.kind === "changed") {
      text = result.text;
      statuses.push(writtenStatus(write));
      details.push(`${entry.file}: ${where} set to ${JSON.stringify(edit.value)}`);
    } else {
      statuses.push("already-applied");
    }
  }
  const status = worst(statuses);
  if (write && status === "applied" && text !== original) io.write(entry.file, text);
  return fail(status, ...details);
};

export const applyOverlay = (
  manifest: KodoManifest,
  io: OverlayIo,
  options: { readonly write: boolean },
): ReadonlyArray<EntryResult> => [
  ...manifest.assets.map((entry) => evaluateAsset(entry, io, options.write)),
  ...manifest.replacements.map((entry) => evaluateReplacement(entry, io, options.write)),
  ...manifest.jsonEdits.map((entry) => evaluateJsonEdit(entry, io, options.write)),
  ...(manifest.brandCodemod ? evaluateBrandCodemod(manifest.brandCodemod, io, options.write) : []),
];

export interface HookResult {
  readonly file: string;
  readonly status: "ok" | "missing-file" | "missing-hooks" | "placeholder";
  readonly missing: ReadonlyArray<string>;
  readonly details: ReadonlyArray<string>;
}

export const hookPresent = (text: string, hook: string): boolean => {
  const escaped = hook.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = /[A-Za-z0-9._-]$/.test(hook) ? "(?![A-Za-z0-9_-])" : "";
  return new RegExp(`KODO:\\s*${escaped}${boundary}`).test(text);
};

export const checkHooks = (
  entries: ReadonlyArray<HookEntry>,
  io: OverlayIo,
): ReadonlyArray<HookResult> =>
  entries.map((entry): HookResult => {
    if (isPlaceholder(entry)) {
      return {
        file: entry.file,
        status: "placeholder",
        missing: [],
        details: [`TODO placeholder, not enforced: ${entry.todo}`],
      };
    }
    const text = readText(io, entry.file);
    if (text === undefined) {
      return {
        file: entry.file,
        status: "missing-file",
        missing: entry.hooks,
        details: [
          `hooks: ${entry.file} does not exist, so hooks ${entry.hooks.join(", ")} cannot be present. Upstream deleted or renamed it: find where it went (git log --diff-filter=DR --summary -M -- ${entry.file}), re-home the hooks there and update the manifest.`,
        ],
      };
    }
    const missing = entry.hooks.filter((hook) => !hookPresent(text, hook));
    return {
      file: entry.file,
      status: missing.length > 0 ? "missing-hooks" : "ok",
      missing,
      details:
        missing.length > 0
          ? [
              `hooks: ${entry.file} lost ${missing.map((hook) => `"KODO: ${hook}"`).join(", ")}. A merge resolution dropped the Kodo edit: restore it from the previous Kodo commit.`,
            ]
          : [],
    };
  });

export interface LeakHit {
  readonly checkId: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface LeakResult {
  readonly checkId: string;
  readonly status: "ok" | "leaks" | "no-files" | "placeholder";
  readonly fileCount: number;
  readonly allowedCount: number;
  readonly hits: ReadonlyArray<LeakHit>;
  readonly details: ReadonlyArray<string>;
}

const MAX_LEAK_FILE_BYTES = 2 * 1024 * 1024;

const lineMatcher = (check: LeakCheckEntry): ((line: string) => boolean) => {
  const tests = check.forbid.map((pattern) => {
    if ("text" in pattern) return (line: string) => line.includes(pattern.text);
    const flags = (pattern.flags ?? "").replace(/[gy]/g, "");
    const regex = new RegExp(pattern.regex, flags);
    return (line: string) => regex.test(line);
  });
  return (line) => tests.some((test) => test(line));
};

export const runLeakChecks = (
  entries: ReadonlyArray<LeakCheckEntry>,
  io: OverlayIo,
): ReadonlyArray<LeakResult> => {
  const all = io.listFiles();
  return entries.map((check): LeakResult => {
    if (isPlaceholder(check)) {
      return {
        checkId: check.id,
        status: "placeholder",
        fileCount: 0,
        allowedCount: 0,
        hits: [],
        details: [`TODO placeholder, not enforced: ${check.todo}`],
      };
    }
    const files = all.filter((file) => matchesAnyGlob(file, check.files));
    if (files.length === 0) {
      return {
        checkId: check.id,
        status: "no-files",
        fileCount: 0,
        allowedCount: 0,
        hits: [],
        details: [
          `leakChecks "${check.id}": no file matches ${check.files.join(", ")}. The checked sources moved or the glob is wrong: a check over nothing proves nothing.`,
        ],
      };
    }
    const matches = lineMatcher(check);
    const hits: LeakHit[] = [];
    let allowedCount = 0;
    for (const file of files) {
      const bytes = io.readBytes(file);
      if (bytes === undefined || bytes.length > MAX_LEAK_FILE_BYTES || bytes.includes(0)) continue;
      const lines = decoder.decode(bytes).split("\n");
      for (const [index, line] of lines.entries()) {
        if (!matches(line)) continue;
        const allowed = check.allow.some(
          (rule) =>
            (rule.file === undefined || matchesGlob(file, rule.file)) &&
            (rule.text === undefined || line.includes(rule.text)),
        );
        if (allowed) allowedCount++;
        else
          hits.push({ checkId: check.id, file, line: index + 1, text: line.trim().slice(0, 160) });
      }
    }
    return {
      checkId: check.id,
      status: hits.length > 0 ? "leaks" : "ok",
      fileCount: files.length,
      allowedCount,
      hits,
      details:
        hits.length > 0
          ? [
              `leakChecks "${check.id}": ${hits.length} upstream brand string(s) in user-visible source. Rebrand them with a replacement entry or allowlist them with a reason.`,
            ]
          : [],
    };
  });
};

export interface OwnedPathViolation {
  readonly file: string;
  readonly owned: string;
}

// Upstream is expected never to ship a file under a Kodo-owned path; when it
// does, a future merge can conflict or silently shadow Kodo's file.
export const findOwnedPathViolations = (
  owned: ReadonlyArray<OwnedPathEntry>,
  upstreamFiles: ReadonlyArray<string>,
): ReadonlyArray<OwnedPathViolation> => {
  const active = owned.filter((entry) => !isPlaceholder(entry) && entry.upstreamHasIt !== true);
  return upstreamFiles.flatMap((file) => {
    const hit = active.find((entry) => matchesOwnedPath(file, entry.path));
    return hit ? [{ file, owned: hit.path }] : [];
  });
};
