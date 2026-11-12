import { assert, describe, it } from "@effect/vitest";

import {
  compareStableTags,
  isPrereleaseBeyond,
  isStableTag,
  newestStableTag,
  parseUpstreamBase,
  renderUpstreamBase,
  stableTagsNewestFirst,
  syncBranchBase,
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
});
