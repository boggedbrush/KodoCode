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

// Upstream's tags are fetched into their own namespace, never into refs/tags, so a tag Kodo
// publishes under the same name can neither collide with them nor be mistaken for a release.
export const UPSTREAM_TAG_NAMESPACE = "refs/upstream-tags";

export const upstreamTagRef = (tag: string): string => `${UPSTREAM_TAG_NAMESPACE}/${tag}`;

export const UPSTREAM_TAG_REFSPEC = `+refs/tags/*:${UPSTREAM_TAG_NAMESPACE}/*`;

// `git ls-remote --tags` output as tag name -> commit. An annotated tag is advertised twice
// (the tag object, then `<tag>^{}` for the commit it points at); the commit wins.
export const parseLsRemoteTags = (output: string): Map<string, string> => {
  const direct = new Map<string, string>();
  const peeled = new Map<string, string>();
  for (const line of output.split("\n")) {
    const match = /^([0-9a-f]{40,64})\s+refs\/tags\/(.+)$/.exec(line.trim());
    if (match === null) continue;
    const [, sha, name] = match;
    if (name!.endsWith("^{}")) peeled.set(name!.slice(0, -3), sha!);
    else direct.set(name!, sha!);
  }
  return new Map([...direct, ...peeled]);
};

export type TagVerification =
  | { readonly ok: true; readonly commit: string }
  | { readonly ok: false; readonly reason: string };

// The fetched tag must point at the commit the upstream remote advertises right now.
export const compareTagWithRemote = (input: {
  readonly tag: string;
  readonly remote: string;
  readonly localCommit: string | undefined;
  // undefined: the remote could not be reached.
  readonly remoteTags: ReadonlyMap<string, string> | undefined;
}): TagVerification => {
  const { tag, remote, localCommit, remoteTags } = input;
  if (localCommit === undefined) {
    return {
      ok: false,
      reason: `${tag} is not among the tags fetched from ${remote} (${upstreamTagRef(tag)}); a tag of that name in refs/tags does not count.`,
    };
  }
  if (remoteTags === undefined) {
    return { ok: false, reason: `${remote} could not be reached to verify ${tag}.` };
  }
  const advertised = remoteTags.get(tag);
  if (advertised === undefined) {
    return { ok: false, reason: `${remote} does not advertise a tag ${tag}.` };
  }
  if (advertised !== localCommit) {
    return {
      ok: false,
      reason: `${tag} points at ${localCommit.slice(0, 10)} locally but ${remote} advertises ${advertised.slice(0, 10)}.`,
    };
  }
  return { ok: true, commit: localCommit };
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
  // Set only by a run in which `check` and every verification command passed; see `kodo:verify`.
  readonly verified?: { readonly date: string; readonly commit: string };
}

export const renderUpstreamBase = (base: UpstreamBase): string =>
  [
    "# Written by `pnpm kodo:sync` and `pnpm kodo:verify`. The upstream (T3 Code) release this fork is based on.",
    "# `verified` appears only after check and every verification command passed; `kodo:check --release` requires it.",
    `tag: ${base.tag ?? "none (unreleased upstream commit)"}`,
    `commit: ${base.commit}`,
    `synced: ${base.synced}`,
    ...(base.verified
      ? [`verified: ${base.verified.date}`, `verified-commit: ${base.verified.commit}`]
      : []),
    "",
  ].join("\n");

export const parseUpstreamBase = (text: string): UpstreamBase | undefined => {
  const field = (name: string): string | undefined =>
    new RegExp(`^${name}:\\s*(.+)$`, "m").exec(text)?.[1]?.trim();
  const tag = field("tag");
  const commit = field("commit");
  const synced = field("synced");
  if (tag === undefined || commit === undefined || synced === undefined) return undefined;
  const verifiedDate = field("verified");
  const verifiedCommit = field("verified-commit");
  return {
    tag: isStableTag(tag) ? tag : undefined,
    commit,
    synced,
    ...(verifiedDate !== undefined && verifiedCommit !== undefined
      ? { verified: { date: verifiedDate, commit: verifiedCommit } }
      : {}),
  };
};
