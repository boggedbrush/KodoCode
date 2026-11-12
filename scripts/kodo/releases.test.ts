import { assert, describe, it } from "@effect/vitest";

import {
  compareStableTags,
  compareTagWithRemote,
  isPrereleaseBeyond,
  isStableTag,
  newestStableTag,
  parseLsRemoteTags,
  parseUpstreamBase,
  renderUpstreamBase,
  stableTagsNewestFirst,
  syncBranchBase,
  upstreamTagRef,
} from "./releases.ts";

describe("stable tag selection", () => {
  it("accepts only plain vX.Y.Z tags", () => {
    for (const tag of ["v0.1.9", "v10.20.30", "v0.0.0"]) assert.isTrue(isStableTag(tag), tag);
    for (const tag of [
      "v0.1.9-preview.20261111.4536",
      "v0.1.10-nightly.20261112.1",
      "v0.0.0-alpha.1",
      "0.1.9",
      "v0.1",
      "v0.1.9.1",
      "v0.1.9-kodo1",
      "android-beta",
    ]) {
      assert.isFalse(isStableTag(tag), tag);
    }
  });

  it("orders by semver, not by string, so v0.1.10 beats v0.1.9", () => {
    assert.deepStrictEqual(
      stableTagsNewestFirst(["v0.1.9", "v0.1.10", "v0.1.2", "v0.2.0", "v1.0.0", "v0.10.0"]),
      ["v1.0.0", "v0.10.0", "v0.2.0", "v0.1.10", "v0.1.9", "v0.1.2"],
    );
    assert.isTrue(compareStableTags("v0.1.10", "v0.1.9") < 0);
  });

  it("ignores previews and nightlies when picking the newest", () => {
    assert.strictEqual(
      newestStableTag([
        "v0.1.9",
        "v0.1.10-preview.20261112.1",
        "v0.2.0-nightly.20261113.2",
        "v0.1.8",
      ]),
      "v0.1.9",
    );
  });

  it("returns undefined when there are no stable tags", () => {
    assert.strictEqual(newestStableTag([]), undefined);
    assert.strictEqual(
      newestStableTag(["v0.1.9-preview.1", "v0.0.0-alpha.3", "nightly"]),
      undefined,
    );
  });

  it("knows which prereleases lie beyond a stable release", () => {
    assert.isTrue(isPrereleaseBeyond("v0.1.10-preview.20261112.1", "v0.1.9"));
    assert.isTrue(isPrereleaseBeyond("v0.2.0-nightly.1", "v0.1.9"));
    assert.isFalse(isPrereleaseBeyond("v0.1.9-preview.20261111.4536", "v0.1.9"));
    assert.isFalse(isPrereleaseBeyond("v0.1.9", "v0.1.9"));
  });
});

describe("sync branch names and the base file", () => {
  it("names a release sync after the release and others after the date", () => {
    assert.strictEqual(syncBranchBase("v0.1.10", "2026-12-01"), "sync/upstream-v0.1.10");
    assert.strictEqual(syncBranchBase("upstream/main", "2026-12-01"), "sync/upstream-2026-12-01");
    assert.strictEqual(
      syncBranchBase("v0.1.10-preview.1", "2026-12-01"),
      "sync/upstream-2026-12-01",
    );
  });

  it("round-trips the base file and tolerates an unreleased base", () => {
    const base = { tag: "v0.1.9", commit: "a".repeat(40), synced: "2026-11-12" };
    const text = renderUpstreamBase(base);
    assert.include(text, "tag: v0.1.9\n");
    assert.deepStrictEqual(parseUpstreamBase(text), base);
    const unreleased = parseUpstreamBase(renderUpstreamBase({ ...base, tag: undefined }));
    assert.strictEqual(unreleased?.tag, undefined);
    assert.strictEqual(parseUpstreamBase("garbage"), undefined);
  });

  it("round-trips the verification marker, which a plain base does not carry", () => {
    const base = { tag: "v0.1.9", commit: "a".repeat(40), synced: "2026-11-12" };
    assert.isUndefined(parseUpstreamBase(renderUpstreamBase(base))?.verified);
    const verified = { ...base, verified: { date: "2026-11-13", commit: "b".repeat(40) } };
    assert.deepStrictEqual(parseUpstreamBase(renderUpstreamBase(verified)), verified);
  });
});

describe("upstream tag verification", () => {
  const sha = (char: string) => char.repeat(40);

  it("reads ls-remote output and prefers the peeled commit of an annotated tag", () => {
    const tags = parseLsRemoteTags(
      [
        `${sha("a")}\trefs/tags/v0.1.9`,
        `${sha("b")}\trefs/tags/v0.1.10`,
        `${sha("c")}\trefs/tags/v0.1.10^{}`,
        "garbage",
      ].join("\n"),
    );
    assert.strictEqual(tags.get("v0.1.9"), sha("a"));
    assert.strictEqual(tags.get("v0.1.10"), sha("c"));
    assert.strictEqual(upstreamTagRef("v0.1.9"), "refs/upstream-tags/v0.1.9");
  });

  it("accepts a tag only when the remote advertises the same commit", () => {
    const remoteTags = new Map([["v0.1.9", sha("a")]]);
    const check = (localCommit: string | undefined, tags: typeof remoteTags | undefined) =>
      compareTagWithRemote({ tag: "v0.1.9", remote: "upstream", localCommit, remoteTags: tags });
    assert.deepStrictEqual(check(sha("a"), remoteTags), { ok: true, commit: sha("a") });
    const mismatch = check(sha("b"), remoteTags);
    assert.isFalse(mismatch.ok);
    assert.include(mismatch.ok ? "" : mismatch.reason, "advertises");
    assert.isFalse(check(undefined, remoteTags).ok);
    assert.include(
      (check(sha("a"), undefined) as { reason: string }).reason,
      "could not be reached",
    );
    assert.include((check(sha("a"), new Map()) as { reason: string }).reason, "does not advertise");
  });
});
