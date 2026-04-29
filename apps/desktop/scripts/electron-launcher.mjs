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
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const APP_DISPLAY_NAME = isDevelopment ? "Kodo Code (Dev)" : "Kodo Code (Alpha)";
const APP_BUNDLE_ID = isDevelopment ? "app.kodocode.dev" : "app.kodocode";
const LAUNCHER_VERSION = 4;
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

function ensureMainBundleInfoPlist(appBundlePath) {
  const contentsDir = join(appBundlePath, "Contents");
  const infoPlistPath = join(contentsDir, "Info.plist");
  if (existsSync(infoPlistPath)) {
    return infoPlistPath;
  }

  mkdirSync(contentsDir, { recursive: true });
  writeFileSync(
    infoPlistPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>Electron</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
</dict>
</plist>
`,
  );
  return infoPlistPath;
}

function patchMainBundleInfoPlist(appBundlePath, iconPath) {
  const infoPlistPath = ensureMainBundleInfoPlist(appBundlePath);
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

function repairFrameworkVersionSymlinks(appBundlePath) {
  const frameworksDir = join(appBundlePath, "Contents", "Frameworks");
  if (!existsSync(frameworksDir)) {
    return;
  }

  for (const entry of readdirSync(frameworksDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith(".framework")) {
      continue;
    }

    const frameworkPath = join(frameworksDir, entry.name);
    const frameworkExecutable = entry.name.replace(/\.framework$/, "");
    const versionsDir = join(frameworkPath, "Versions");
    const versionAPath = join(versionsDir, "A");
    const currentPath = join(versionsDir, "Current");
    if (!existsSync(versionAPath)) {
      continue;
    }

    if (!existsSync(currentPath)) {
      rmSync(currentPath, { force: true });
      symlinkSync("A", currentPath);
    }

    const executablePath = join(frameworkPath, frameworkExecutable);
    if (existsSync(join(versionAPath, frameworkExecutable))) {
      rmSync(executablePath, { force: true });
      symlinkSync(`Versions/Current/${frameworkExecutable}`, executablePath);
    }

    const resourcesPath = join(frameworkPath, "Resources");
    if (existsSync(join(versionAPath, "Resources"))) {
      rmSync(resourcesPath, { force: true });
      symlinkSync("Versions/Current/Resources", resourcesPath);
    }
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function resolveMacLauncherIconPath() {
  const iconPath = isDevelopment
    ? resolve(desktopDir, "../../assets/dev/blueprint-macos.icns")
    : join(desktopDir, "resources", "icon.icns");

  if (!existsSync(iconPath)) {
    throw new Error(`Missing macOS launcher icon: ${iconPath}`);
  }

  return iconPath;
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
  const targetInfoPlistPath = join(targetAppBundlePath, "Contents", "Info.plist");
  const iconPath = resolveMacLauncherIconPath();
  const metadataPath = join(runtimeDir, "metadata.json");

  mkdirSync(runtimeDir, { recursive: true });

  const expectedMetadata = {
    launcherVersion: LAUNCHER_VERSION,
    appDisplayName: APP_DISPLAY_NAME,
    appBundleId: APP_BUNDLE_ID,
    sourceAppBundlePath,
    sourceAppMtimeMs: statSync(sourceAppBundlePath).mtimeMs,
    iconPath,
    iconMtimeMs: statSync(iconPath).mtimeMs,
  };

  const currentMetadata = readJson(metadataPath);
  if (
    existsSync(targetBinaryPath) &&
    existsSync(targetInfoPlistPath) &&
    currentMetadata &&
    JSON.stringify(currentMetadata) === JSON.stringify(expectedMetadata)
  ) {
    return targetBinaryPath;
  }

  rmSync(targetAppBundlePath, { recursive: true, force: true });
  cpSync(sourceAppBundlePath, targetAppBundlePath, { recursive: true, verbatimSymlinks: true });
  repairFrameworkVersionSymlinks(targetAppBundlePath);
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
