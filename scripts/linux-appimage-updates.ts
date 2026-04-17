import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export interface LinuxUpdateFile {
  readonly url: string;
  readonly sha512: string;
  readonly size: number;
}

export interface LinuxUpdateManifest {
  readonly version: string;
  readonly releaseDate: string;
  readonly files: ReadonlyArray<LinuxUpdateFile>;
  readonly path: string;
  readonly sha512: string;
}

export interface RepackLinuxAppImageOptions {
  readonly appImagePath: string;
  readonly manifestPath: string;
  readonly appimagetoolPath: string;
  readonly owner: string;
  readonly repo: string;
  readonly version: string;
  readonly releaseTag?: string;
}

function quoteYamlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function toAppImageZsyncAssetName(assetName: string, version: string): string {
  if (!assetName.endsWith(".AppImage")) {
    throw new Error(`Expected an AppImage asset name, received '${assetName}'.`);
  }

  const versionMarker = `-${version}-`;
  if (!assetName.includes(versionMarker)) {
    throw new Error(
      `Cannot derive AppImage update pattern from '${assetName}' because version '${version}' was not found.`,
    );
  }

  return assetName.replace(versionMarker, "-*-") + ".zsync";
}

export function buildGitHubReleasesZsyncUpdateInformation(args: {
  readonly owner: string;
  readonly repo: string;
  readonly assetName: string;
  readonly version: string;
  readonly releaseTag?: string;
}): string {
  return [
    "gh-releases-zsync",
    args.owner,
    args.repo,
    args.releaseTag ?? "latest",
    toAppImageZsyncAssetName(args.assetName, args.version),
  ].join("|");
}

export function serializeLinuxUpdateManifest(manifest: LinuxUpdateManifest): string {
  const lines = [`version: ${manifest.version}`, "files:"];

  for (const file of manifest.files) {
    lines.push(`  - url: ${file.url}`);
    lines.push(`    sha512: ${file.sha512}`);
    lines.push(`    size: ${file.size}`);
  }

  lines.push(`path: ${manifest.path}`);
  lines.push(`sha512: ${manifest.sha512}`);
  lines.push(`releaseDate: ${quoteYamlString(manifest.releaseDate)}`);

  return `${lines.join("\n")}\n`;
}

function computeSha512Base64(filePath: string): string {
  return createHash("sha512").update(readFileSync(filePath)).digest("base64");
}

function assertZsyncmakeAvailable(): void {
  const result = spawnSync("zsyncmake", ["-V"], { encoding: "utf8" });
  if (result.status === 0) {
    return;
  }
  throw new Error(
    "zsyncmake is required to generate AppImage delta update metadata, but it was not found in PATH.",
  );
}

function resolveAppImageArch(assetName: string): string {
  if (assetName.endsWith("-x86_64.AppImage")) {
    return "x86_64";
  }
  if (assetName.endsWith("-aarch64.AppImage")) {
    return "aarch64";
  }
  throw new Error(`Unsupported AppImage asset name '${assetName}'.`);
}

export function repackLinuxAppImageWithExternalUpdater(options: RepackLinuxAppImageOptions): {
  readonly updateInformation: string;
  readonly zsyncPath: string;
} {
  const assetName = basename(options.appImagePath);
  const arch = resolveAppImageArch(assetName);
  const updateInformation = buildGitHubReleasesZsyncUpdateInformation({
    owner: options.owner,
    repo: options.repo,
    assetName,
    version: options.version,
    ...(options.releaseTag ? { releaseTag: options.releaseTag } : {}),
  });

  assertZsyncmakeAvailable();
  chmodSync(options.appImagePath, 0o755);
  chmodSync(options.appimagetoolPath, 0o755);

  const tempRoot = mkdtempSync(join(tmpdir(), "kodo-appimage-update-"));

  try {
    execFileSync(options.appImagePath, ["--appimage-extract"], {
      cwd: tempRoot,
      env: {
        ...process.env,
        APPIMAGE_EXTRACT_AND_RUN: "1",
      },
      stdio: "inherit",
    });

    const extractedRoot = join(tempRoot, "squashfs-root");
    if (!existsSync(extractedRoot)) {
      throw new Error(`AppImage extraction did not produce ${extractedRoot}.`);
    }

    const repackedAppImagePath = join(tempRoot, assetName);
    execFileSync(
      options.appimagetoolPath,
      ["-u", updateInformation, extractedRoot, repackedAppImagePath],
      {
        cwd: tempRoot,
        env: {
          ...process.env,
          APPIMAGE_EXTRACT_AND_RUN: "1",
          ARCH: arch,
        },
        stdio: "inherit",
      },
    );

    const repackedZsyncPath = `${repackedAppImagePath}.zsync`;
    if (!existsSync(repackedAppImagePath)) {
      throw new Error(`Re-packed AppImage was not created at ${repackedAppImagePath}.`);
    }
    if (!existsSync(repackedZsyncPath)) {
      throw new Error(`Expected zsync metadata at ${repackedZsyncPath}, but it was not created.`);
    }

    const finalZsyncPath = `${options.appImagePath}.zsync`;
    copyFileSync(repackedAppImagePath, options.appImagePath);
    copyFileSync(repackedZsyncPath, finalZsyncPath);
    chmodSync(options.appImagePath, 0o755);

    const sha512 = computeSha512Base64(options.appImagePath);
    const size = statSync(options.appImagePath).size;

    writeFileSync(
      options.manifestPath,
      serializeLinuxUpdateManifest({
        version: options.version,
        files: [
          {
            url: assetName,
            sha512,
            size,
          },
        ],
        path: assetName,
        sha512,
        releaseDate: new Date().toISOString(),
      }),
    );

    return {
      updateInformation,
      zsyncPath: finalZsyncPath,
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
