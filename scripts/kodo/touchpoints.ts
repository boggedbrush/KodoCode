// Which parts of the overlay an upstream range touches. Used by `sync --dry-run`
// (to size a sync before starting) and by sync's own preflight; pure so the
// messages can be unit-tested.
import { isPlaceholder, type KodoManifest } from "./manifest.ts";
import { matchesAnyGlob } from "./paths.ts";

export interface UpstreamChange {
  readonly status: "A" | "M" | "D" | "R" | "C" | "T";
  readonly path: string;
  // For renames and copies, the previous path.
  readonly oldPath?: string;
}

// `git diff --name-status -M -z` output: "M\0path\0", "R100\0old\0new\0".
export const parseNameStatusZ = (output: string): ReadonlyArray<UpstreamChange> => {
  const tokens = output.split("\0");
  const changes: UpstreamChange[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const code = tokens[i];
    if (!code) continue;
    const kind = code[0] as UpstreamChange["status"];
    if (kind === "R" || kind === "C") {
      const oldPath = tokens[i + 1];
      const path = tokens[i + 2];
      i += 2;
      if (oldPath !== undefined && path !== undefined)
        changes.push({ status: kind, path, oldPath });
    } else {
      const path = tokens[i + 1];
      i += 1;
      if (path !== undefined) changes.push({ status: kind, path });
    }
  }
  return changes;
};

export interface Touchpoint {
  // "attention": a human decision is likely; "info": the overlay may need re-applying.
  readonly severity: "attention" | "info";
  readonly entry: string;
  readonly message: string;
}

const describe = (change: UpstreamChange): string =>
  change.status === "D"
    ? "deleted upstream"
    : change.status === "R"
      ? `renamed upstream (now ${change.path})`
      : change.status === "A"
        ? "added upstream"
        : "changed upstream";

export const findTouchpoints = (
  manifest: KodoManifest,
  changes: ReadonlyArray<UpstreamChange>,
): ReadonlyArray<Touchpoint> => {
  const touchpoints: Touchpoint[] = [];
  // The path the overlay knows the file by: a rename is matched on its old path.
  const matching = (match: (path: string) => boolean) =>
    changes.filter((change) => match(change.oldPath ?? change.path));
  const report = (entry: string, change: UpstreamChange, what: string, fix: string) => {
    const gone = change.status === "D" || change.status === "R";
    touchpoints.push({
      severity: gone ? "attention" : "info",
      entry,
      message: `${entry}: ${what} ${change.oldPath ?? change.path} was ${describe(change)}.${gone ? ` ${fix}` : ""}`,
    });
  };

  for (const entry of manifest.hooks) {
    if (isPlaceholder(entry)) continue;
    for (const change of matching((path) => path === entry.file)) {
      report(
        `hooks ${entry.file}`,
        change,
        `hooked file`,
        `Re-home hooks ${entry.hooks.join(", ")} and update the manifest.`,
      );
    }
  }
  for (const entry of manifest.replacements) {
    if (isPlaceholder(entry)) continue;
    for (const change of matching((path) => matchesAnyGlob(path, entry.files))) {
      report(
        `replacements "${entry.id}"`,
        change,
        "replacement target",
        "Update the entry's files.",
      );
    }
  }
  for (const entry of manifest.jsonEdits) {
    if (isPlaceholder(entry)) continue;
    for (const change of matching((path) => path === entry.file)) {
      report(`jsonEdits "${entry.id}"`, change, "edited file", "Update the entry's file.");
    }
  }
  for (const entry of manifest.assets) {
    if (isPlaceholder(entry)) continue;
    for (const change of matching((path) => entry.destinations.includes(path))) {
      report(`assets "${entry.id}"`, change, "asset destination", "Update the destination.");
    }
  }
  for (const lockfile of manifest.upstream.lockfiles) {
    for (const change of matching((path) => path === lockfile)) {
      touchpoints.push({
        severity: "info",
        entry: `lockfile ${lockfile}`,
        message: `lockfile ${lockfile} was ${describe(change)}: reinstall dependencies after the merge.`,
      });
    }
  }
  return touchpoints;
};
