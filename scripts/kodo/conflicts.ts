// Merge-conflict policy: which conflicted paths may be resolved mechanically
// and which must stay for a human. Only unambiguous cases are automatic.
import { isPlaceholder, type KodoManifest } from "./manifest.ts";
import { codemodInScope } from "./brandCodemodRun.ts";
import { matchesAnyGlob, matchesOwnedPath } from "./paths.ts";

// A path left unmerged by `git merge`, described by which index stages exist
// (1 base, 2 ours, 3 theirs). A missing stage means that side has no such file.
export interface UnmergedFile {
  readonly path: string;
  readonly hasBase: boolean;
  readonly hasOurs: boolean;
  readonly hasTheirs: boolean;
}

export type Resolution =
  // Kodo-owned: keep our side (delete the path when our side has no file).
  | { readonly kind: "ours"; readonly why: string }
  // Upstream's version wins now; `apply` (or a reinstall) regenerates the Kodo part.
  | { readonly kind: "theirs"; readonly why: string; readonly followUp: "apply" | "reinstall" }
  | { readonly kind: "manual"; readonly why: string; readonly hints: ReadonlyArray<string> };

export interface ClassifiedConflict extends UnmergedFile {
  readonly resolution: Resolution;
}

const overlayHints = (path: string, manifest: KodoManifest): string[] => {
  const hints: string[] = [];
  for (const entry of manifest.hooks) {
    if (entry.file === path && !isPlaceholder(entry)) {
      hints.push(`keep Kodo hooks: ${entry.hooks.map((hook) => `KODO: ${hook}`).join(", ")}`);
    }
  }
  for (const entry of manifest.replacements) {
    if (!isPlaceholder(entry) && matchesAnyGlob(path, entry.files)) {
      hints.push(
        `replacement "${entry.id}" targets this file: take upstream's text where unsure, then run kodo:apply`,
      );
    }
  }
  for (const entry of manifest.jsonEdits) {
    if (entry.file === path && !isPlaceholder(entry)) {
      hints.push(
        `jsonEdits "${entry.id}" targets this file: take upstream's value, then run kodo:apply`,
      );
    }
  }
  if (
    manifest.brandCodemod &&
    !isPlaceholder(manifest.brandCodemod) &&
    codemodInScope(manifest.brandCodemod, path)
  ) {
    hints.push(
      "in brand codemod scope: take upstream's wording for brand literals, then run kodo:apply",
    );
  }
  return hints;
};

// Facts the manifest alone cannot answer, supplied by the engine from git.
export interface ConflictContext {
  // Whether our version of the file is exactly the brand codemod's output for the merge base.
  readonly isCodemodOwned?: (path: string) => boolean;
}

export const classifyConflict = (
  file: UnmergedFile,
  manifest: KodoManifest,
  context: ConflictContext = {},
): ClassifiedConflict => {
  const owned = manifest.kodoOwned.find(
    (entry) => !isPlaceholder(entry) && matchesOwnedPath(file.path, entry.path),
  );
  if (owned) {
    return {
      ...file,
      resolution: {
        kind: "ours",
        why: `Kodo-owned path (${owned.path}): upstream is not expected to ship it, ours wins`,
      },
    };
  }
  if (manifest.upstream.lockfiles.includes(file.path)) {
    return {
      ...file,
      resolution: file.hasTheirs
        ? {
            kind: "theirs",
            why: "lockfile: take upstream's, then reinstall to re-resolve Kodo's dependency changes",
            followUp: "reinstall",
          }
        : {
            kind: "manual",
            why: "lockfile was deleted upstream",
            hints: ["decide whether the project still uses this lockfile"],
          },
    };
  }
  const asset = manifest.assets.find(
    (entry) => !isPlaceholder(entry) && entry.destinations.includes(file.path),
  );
  if (asset) {
    return {
      ...file,
      resolution:
        file.hasOurs && file.hasTheirs
          ? {
              kind: "theirs",
              why: `asset destination of "${asset.id}": regenerated from ${asset.source} by apply`,
              followUp: "apply",
            }
          : {
              kind: "manual",
              why: `asset destination of "${asset.id}" was ${file.hasTheirs ? "deleted on our side" : "deleted or moved upstream"}`,
              hints: [`update the destinations of assets "${asset.id}" in the manifest`],
            },
    };
  }
  const hooked = manifest.hooks.some((entry) => entry.file === file.path && !isPlaceholder(entry));
  if (
    file.hasBase &&
    file.hasOurs &&
    file.hasTheirs &&
    !hooked &&
    manifest.brandCodemod &&
    !isPlaceholder(manifest.brandCodemod) &&
    codemodInScope(manifest.brandCodemod, file.path) &&
    context.isCodemodOwned?.(file.path) === true
  ) {
    return {
      ...file,
      resolution: {
        kind: "theirs",
        why: "codemod-owned: only the brand codemod differs from upstream, so upstream's version is taken and the codemod re-runs",
        followUp: "apply",
      },
    };
  }
  return {
    ...file,
    resolution: {
      kind: "manual",
      why: describeShape(file),
      hints: overlayHints(file.path, manifest),
    },
  };
};

export const describeShape = (file: UnmergedFile): string => {
  if (file.hasOurs && file.hasTheirs) {
    return file.hasBase ? "both sides modified it" : "both sides added it";
  }
  return file.hasTheirs
    ? "deleted on our side, modified upstream"
    : "modified on our side, deleted upstream";
};

export const classifyConflicts = (
  files: ReadonlyArray<UnmergedFile>,
  manifest: KodoManifest,
  context: ConflictContext = {},
): ReadonlyArray<ClassifiedConflict> =>
  files
    .map((file) => classifyConflict(file, manifest, context))
    .toSorted((a, b) => a.path.localeCompare(b.path));

// `git ls-files -u -z` records (newline separated is accepted too): "<mode> <sha> <stage>\t<path>".
export const parseUnmergedIndex = (output: string): ReadonlyArray<UnmergedFile> => {
  const byPath = new Map<string, { base: boolean; ours: boolean; theirs: boolean }>();
  for (const line of output.split(/[\0\n]/)) {
    const match = /^\d+ [0-9a-f]+ ([123])\t(.+)$/.exec(line);
    if (!match) continue;
    const path = match[2] as string;
    const entry = byPath.get(path) ?? { base: false, ours: false, theirs: false };
    if (match[1] === "1") entry.base = true;
    else if (match[1] === "2") entry.ours = true;
    else entry.theirs = true;
    byPath.set(path, entry);
  }
  return [...byPath].map(([path, entry]) => ({
    path,
    hasBase: entry.base,
    hasOurs: entry.ours,
    hasTheirs: entry.theirs,
  }));
};
