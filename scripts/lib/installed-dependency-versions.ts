import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface BunLockFile {
  readonly packages?: Record<string, unknown>;
}

function parseBunLockFile(content: string): BunLockFile {
  // Bun emits a JSON-like lockfile with trailing commas, so normalize that
  // before decoding package metadata used by release packaging.
  return JSON.parse(content.replace(/,\s*([}\]])/g, "$1")) as BunLockFile;
}

function parsePackageVersionFromLocator(
  dependencyName: string,
  locator: string,
): string | undefined {
  const prefix = `${dependencyName}@`;
  if (!locator.startsWith(prefix)) {
    return undefined;
  }

  const version = locator.slice(prefix.length).trim();
  return version.length > 0 ? version : undefined;
}

function readInstalledDependencyVersionFromNodeModules(
  repoRoot: string,
  dependencyName: string,
): string | undefined {
  const dependencyPackageJsonPath = join(
    repoRoot,
    "node_modules",
    ...dependencyName.split("/"),
    "package.json",
  );
  if (!existsSync(dependencyPackageJsonPath)) {
    return undefined;
  }

  const dependencyPackageJson = JSON.parse(readFileSync(dependencyPackageJsonPath, "utf8")) as {
    readonly version?: unknown;
  };
  if (
    typeof dependencyPackageJson.version !== "string" ||
    dependencyPackageJson.version.length === 0
  ) {
    return undefined;
  }

  return dependencyPackageJson.version;
}

function readInstalledDependencyVersionsFromBunLock(repoRoot: string): ReadonlyMap<string, string> {
  const bunLockPath = join(repoRoot, "bun.lock");
  if (!existsSync(bunLockPath)) {
    return new Map();
  }

  const lockfile = parseBunLockFile(readFileSync(bunLockPath, "utf8"));
  if (!lockfile.packages) {
    return new Map();
  }

  const versions = new Map<string, string>();
  for (const [dependencyName, entry] of Object.entries(lockfile.packages)) {
    if (!Array.isArray(entry)) {
      continue;
    }

    const locator = entry[0];
    if (typeof locator !== "string") {
      continue;
    }

    const version = parsePackageVersionFromLocator(dependencyName, locator);
    if (!version) {
      continue;
    }

    versions.set(dependencyName, version);
  }

  return versions;
}

function readInstalledDependencyVersion(
  repoRoot: string,
  dependencyName: string,
  bunLockVersions: ReadonlyMap<string, string>,
): string | undefined {
  return (
    readInstalledDependencyVersionFromNodeModules(repoRoot, dependencyName) ??
    bunLockVersions.get(dependencyName)
  );
}

export function pinInstalledDependencyVersions(
  dependencies: Record<string, unknown>,
  repoRoot: string,
): Record<string, unknown> {
  const bunLockVersions = readInstalledDependencyVersionsFromBunLock(repoRoot);
  const pinnedDependencies: Record<string, unknown> = {};
  const missingInstalledVersions: string[] = [];

  // Pin to installed versions so stage installs remain deterministic across release runs.
  for (const [dependencyName] of Object.entries(dependencies)) {
    const installedVersion = readInstalledDependencyVersion(
      repoRoot,
      dependencyName,
      bunLockVersions,
    );
    if (!installedVersion) {
      missingInstalledVersions.push(dependencyName);
      continue;
    }
    pinnedDependencies[dependencyName] = installedVersion;
  }

  if (missingInstalledVersions.length > 0) {
    throw new Error(
      `Could not resolve installed versions for: ${missingInstalledVersions.join(", ")}. Run 'bun install --frozen-lockfile' before packaging.`,
    );
  }

  return pinnedDependencies;
}

export const internal = {
  parseBunLockFile,
  parsePackageVersionFromLocator,
  readInstalledDependencyVersionsFromBunLock,
};
