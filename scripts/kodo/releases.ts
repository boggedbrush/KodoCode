// Upstream release policy: Kodo follows stable releases (plain `vX.Y.Z` tags),
// never `main`, previews or nightlies. Pure helpers over tag names and the
// small human-readable base file.

const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const PRERELEASE_TAG = /^v\d+\.\d+\.\d+-(?:preview|nightly)\./;

export const isStableTag = (tag: string): boolean => STABLE_TAG.test(tag);

export const isPrereleaseTag = (tag: string): boolean => PRERELEASE_TAG.test(tag);

const versionOf = (tag: string): [number, number, number] | undefined => {
  const match = STABLE_TAG.exec(tag);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
};

// Highest-first semver order, so v0.1.10 sorts before v0.1.9.
export const compareStableTags = (a: string, b: string): number => {
  const left = versionOf(a) ?? [0, 0, 0];
  const right = versionOf(b) ?? [0, 0, 0];
  return right[0] - left[0] || right[1] - left[1] || right[2] - left[2];
};

export const stableTagsNewestFirst = (tags: ReadonlyArray<string>): string[] =>
  tags.filter(isStableTag).toSorted(compareStableTags);

export const newestStableTag = (tags: ReadonlyArray<string>): string | undefined =>
  stableTagsNewestFirst(tags)[0];

// A prerelease of a version after `stable` (v0.1.10-preview.* when the newest stable is v0.1.9).
export const isPrereleaseBeyond = (prerelease: string, stable: string): boolean => {
  const base = prerelease.replace(/-.*$/, "");
  return isPrereleaseTag(prerelease) && compareStableTags(base, stable) < 0;
};

export const RELEASE_POLICY_SUMMARY =
  "Sync to stable release tags only and never merge upstream/main.";

export const RELEASE_POLICY_MESSAGE =
  "Kodo follows upstream's stable releases (plain vX.Y.Z tags), never main, previews, nightlies or raw commits. Pass --allow-unreleased to override for this run.";

// A branch name for the sync: the release for a stable tag, the date otherwise.
export const syncBranchBase = (ref: string, today: string): string =>
  isStableTag(ref) ? `sync/upstream-${ref}` : `sync/upstream-${today}`;

export interface UpstreamBase {
  // A stable tag, or undefined when the base is an unreleased upstream commit.
  readonly tag: string | undefined;
  readonly commit: string;
  readonly synced: string;
}

export const renderUpstreamBase = (base: UpstreamBase): string =>
  [
    "# Written by `pnpm kodo:sync`. The upstream (T3 Code) release this fork is based on.",
    `tag: ${base.tag ?? "none (unreleased upstream commit)"}`,
    `commit: ${base.commit}`,
    `synced: ${base.synced}`,
    "",
  ].join("\n");

export const parseUpstreamBase = (text: string): UpstreamBase | undefined => {
  const field = (name: string): string | undefined =>
    new RegExp(`^${name}:\\s*(.+)$`, "m").exec(text)?.[1]?.trim();
  const tag = field("tag");
  const commit = field("commit");
  const synced = field("synced");
  if (tag === undefined || commit === undefined || synced === undefined) return undefined;
  return { tag: isStableTag(tag) ? tag : undefined, commit, synced };
};
