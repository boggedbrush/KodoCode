import { assert, describe, it } from "@effect/vitest";

import {
  buildGitHubReleasesZsyncUpdateInformation,
  serializeLinuxUpdateManifest,
  toAppImageZsyncAssetName,
} from "./linux-appimage-updates.ts";

describe("linux-appimage-updates", () => {
  it("derives the GitHub release zsync asset pattern from the versioned AppImage name", () => {
    assert.equal(
      toAppImageZsyncAssetName("Kodo-Code-0.0.1-x86_64.AppImage", "0.0.1"),
      "Kodo-Code-*-x86_64.AppImage.zsync",
    );
  });

  it("builds GitHub release update information for AppImage tools", () => {
    assert.equal(
      buildGitHubReleasesZsyncUpdateInformation({
        owner: "boggedbrush",
        repo: "KodoCode",
        assetName: "Kodo-Code-0.0.1-x86_64.AppImage",
        version: "0.0.1",
      }),
      "gh-releases-zsync|boggedbrush|KodoCode|latest|Kodo-Code-*-x86_64.AppImage.zsync",
    );
  });

  it("serializes the Linux updater manifest without stale blockmap metadata", () => {
    const manifest = serializeLinuxUpdateManifest({
      version: "0.0.1",
      files: [
        {
          url: "Kodo-Code-0.0.1-x86_64.AppImage",
          sha512: "sha-value",
          size: 170338830,
        },
      ],
      path: "Kodo-Code-0.0.1-x86_64.AppImage",
      sha512: "sha-value",
      releaseDate: "2026-04-16T23:42:49.283Z",
    });

    assert.equal(
      manifest,
      `version: 0.0.1
files:
  - url: Kodo-Code-0.0.1-x86_64.AppImage
    sha512: sha-value
    size: 170338830
path: Kodo-Code-0.0.1-x86_64.AppImage
sha512: sha-value
releaseDate: '2026-04-16T23:42:49.283Z'
`,
    );
    assert.ok(!manifest.includes("blockMapSize"));
  });
});
