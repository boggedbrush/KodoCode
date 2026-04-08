// This file mostly exists because we want dev mode to say "Kodo Code (Dev)" instead of "electron"

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const APP_DISPLAY_NAME = isDevelopment ? "Kodo Code (Dev)" : "Kodo Code (Alpha)";
const APP_BUNDLE_ID = "com.kodo.code";
const LAUNCHER_VERSION = 1;
const ELECTRON_INSTALL_CANDIDATES = ["node", "bun"];

const __dirname = dirname(fileURLToPath(import.meta.url));
export const desktopDir = resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const electronPackageDir = dirname(require.resolve("electron/package.json"));

function setPlistString(plistPath, key, value) {
  const replaceResult = spawnSync("plutil", ["-replace", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (replaceResult.status === 0) {
    return;
  }

  const insertResult = spawnSync("plutil", ["-insert", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (insertResult.status === 0) {
    return;
  }

  const details = [replaceResult.stderr, insertResult.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to update plist key "${key}" at ${plistPath}: ${details}`.trim());
}

function patchMainBundleInfoPlist(appBundlePath, iconPath) {
  const infoPlistPath = join(appBundlePath, "Contents", "Info.plist");
  setPlistString(infoPlistPath, "CFBundleDisplayName", APP_DISPLAY_NAME);
  setPlistString(infoPlistPath, "CFBundleName", APP_DISPLAY_NAME);
  setPlistString(infoPlistPath, "CFBundleIdentifier", APP_BUNDLE_ID);
  setPlistString(infoPlistPath, "CFBundleIconFile", "icon.icns");

  const resourcesDir = join(appBundlePath, "Contents", "Resources");
  copyFileSync(iconPath, join(resourcesDir, "icon.icns"));
  copyFileSync(iconPath, join(resourcesDir, "electron.icns"));
}

function patchHelperBundleInfoPlists(appBundlePath) {
  const frameworksDir = join(appBundlePath, "Contents", "Frameworks");
  if (!existsSync(frameworksDir)) {
    return;
  }

  for (const entry of readdirSync(frameworksDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith(".app")) {
      continue;
    }
    if (!entry.name.startsWith("Electron Helper")) {
      continue;
    }

    const helperPlistPath = join(frameworksDir, entry.name, "Contents", "Info.plist");
    if (!existsSync(helperPlistPath)) {
      continue;
    }

    const suffix = entry.name.replace("Electron Helper", "").replace(".app", "").trim();
    const helperName = suffix
      ? `${APP_DISPLAY_NAME} Helper ${suffix}`
      : `${APP_DISPLAY_NAME} Helper`;
    const helperIdSuffix = suffix.replace(/[()]/g, "").trim().toLowerCase().replace(/\s+/g, "-");
    const helperBundleId = helperIdSuffix
      ? `${APP_BUNDLE_ID}.helper.${helperIdSuffix}`
      : `${APP_BUNDLE_ID}.helper`;

    setPlistString(helperPlistPath, "CFBundleDisplayName", helperName);
    setPlistString(helperPlistPath, "CFBundleName", helperName);
    setPlistString(helperPlistPath, "CFBundleIdentifier", helperBundleId);
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function getElectronPlatformPath() {
  switch (process.platform) {
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron";
    case "linux":
      return "electron";
    case "win32":
      return "electron.exe";
    default:
      throw new Error(`Electron is not supported on platform: ${process.platform}`);
  }
}

function getInstalledElectronBinaryPath() {
  const pathFile = join(electronPackageDir, "path.txt");
  const executablePath = existsSync(pathFile) ? readFileSync(pathFile, "utf8").trim() : "";
  const resolvedExecutablePath = executablePath || getElectronPlatformPath();

  const distRoot = process.env.ELECTRON_OVERRIDE_DIST_PATH || join(electronPackageDir, "dist");
  return join(distRoot, resolvedExecutablePath);
}

function installElectronBinary() {
  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
    throw new Error(
      "Electron binary is missing and ELECTRON_SKIP_BINARY_DOWNLOAD is set. " +
        "Reinstall dependencies or run the Electron installer manually.",
    );
  }

  const installScriptPath = join(electronPackageDir, "install.js");
  const lastErrors = [];

  for (const command of ELECTRON_INSTALL_CANDIDATES) {
    const result = spawnSync(command, [installScriptPath], {
      cwd: electronPackageDir,
      encoding: "utf8",
      env: process.env,
    });

    if (result.status === 0) {
      return;
    }

    const stderr = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    lastErrors.push(
      `${command}: ${stderr || result.error?.message || `exited with code ${result.status ?? "unknown"}`}`,
    );
  }

  throw new Error(
    [
      "Electron binary is missing and could not be installed automatically.",
      `Install script: ${installScriptPath}`,
      ...lastErrors.map((error) => `- ${error}`),
    ].join("\n"),
  );
}

function ensureElectronBinary() {
  const existingBinaryPath = getInstalledElectronBinaryPath();
  if (existingBinaryPath && existsSync(existingBinaryPath)) {
    return existingBinaryPath;
  }

  installElectronBinary();

  const installedBinaryPath = getInstalledElectronBinaryPath();
  if (!installedBinaryPath || !existsSync(installedBinaryPath)) {
    throw new Error(
      [
        "Electron installation finished but the executable is still missing.",
        `Expected binary path: ${installedBinaryPath || "<unresolved>"}`,
        `Package dir: ${electronPackageDir}`,
      ].join("\n"),
    );
  }

  return installedBinaryPath;
}

function buildMacLauncher(electronBinaryPath) {
  const sourceAppBundlePath = resolve(electronBinaryPath, "../../..");
  const runtimeDir = join(desktopDir, ".electron-runtime");
  const targetAppBundlePath = join(runtimeDir, `${APP_DISPLAY_NAME}.app`);
  const targetBinaryPath = join(targetAppBundlePath, "Contents", "MacOS", "Electron");
  const iconPath = join(desktopDir, "resources", "icon.icns");
  const metadataPath = join(runtimeDir, "metadata.json");

  mkdirSync(runtimeDir, { recursive: true });

  const expectedMetadata = {
    launcherVersion: LAUNCHER_VERSION,
    sourceAppBundlePath,
    sourceAppMtimeMs: statSync(sourceAppBundlePath).mtimeMs,
    iconMtimeMs: statSync(iconPath).mtimeMs,
  };

  const currentMetadata = readJson(metadataPath);
  if (
    existsSync(targetBinaryPath) &&
    currentMetadata &&
    JSON.stringify(currentMetadata) === JSON.stringify(expectedMetadata)
  ) {
    return targetBinaryPath;
  }

  rmSync(targetAppBundlePath, { recursive: true, force: true });
  cpSync(sourceAppBundlePath, targetAppBundlePath, { recursive: true });
  patchMainBundleInfoPlist(targetAppBundlePath, iconPath);
  patchHelperBundleInfoPlists(targetAppBundlePath);
  writeFileSync(metadataPath, `${JSON.stringify(expectedMetadata, null, 2)}\n`);

  return targetBinaryPath;
}

export function resolveElectronPath() {
  const electronBinaryPath = ensureElectronBinary();

  if (process.platform !== "darwin") {
    return electronBinaryPath;
  }

  return buildMacLauncher(electronBinaryPath);
}
