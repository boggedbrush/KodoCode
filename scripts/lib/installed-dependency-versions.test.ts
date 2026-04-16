import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { internal, pinInstalledDependencyVersions } from "./installed-dependency-versions.ts";

const tempDirs: string[] = [];

function createTempRepoRoot(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "kodo-installed-deps-"));
  tempDirs.push(repoRoot);
  return repoRoot;
}

function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("installed dependency versions", () => {
  it("parses bun lockfiles with Bun's trailing commas", () => {
    expect(
      internal.parseBunLockFile(`{
  "packages": {
    "open": ["open@10.2.0"],
  },
}`),
    ).toEqual({
      packages: {
        open: ["open@10.2.0"],
      },
    });
  });

  it("parses bun package locators into exact versions", () => {
    expect(
      internal.parsePackageVersionFromLocator(
        "@effect/platform-bun",
        "@effect/platform-bun@4.0.0-beta.43",
      ),
    ).toBe("4.0.0-beta.43");
    expect(internal.parsePackageVersionFromLocator("open", "open@10.2.0")).toBe("10.2.0");
    expect(internal.parsePackageVersionFromLocator("open", "node-pty@1.1.0")).toBeUndefined();
  });

  it("falls back to bun.lock package versions when bun keeps packages under .bun", () => {
    const repoRoot = createTempRepoRoot();
    writeJsonFile(join(repoRoot, "bun.lock"), {
      packages: {
        "@effect/platform-bun": ["@effect/platform-bun@4.0.0-beta.43"],
        open: ["open@10.2.0"],
      },
    });

    expect(
      pinInstalledDependencyVersions(
        {
          "@effect/platform-bun": "^4.0.0-beta.43",
          open: "^10.1.0",
        },
        repoRoot,
      ),
    ).toEqual({
      "@effect/platform-bun": "4.0.0-beta.43",
      open: "10.2.0",
    });
  });

  it("prefers a concrete node_modules package version when it exists", () => {
    const repoRoot = createTempRepoRoot();
    writeJsonFile(join(repoRoot, "bun.lock"), {
      packages: {
        open: ["open@10.2.0"],
      },
    });
    writeJsonFile(join(repoRoot, "node_modules", "open", "package.json"), {
      version: "10.2.1",
    });

    expect(
      pinInstalledDependencyVersions(
        {
          open: "^10.1.0",
        },
        repoRoot,
      ),
    ).toEqual({
      open: "10.2.1",
    });
  });
});
