const FS = require("node:fs");
const Path = require("node:path");
const rcedit = require("rcedit");

const APP_NAME = "Kodo Code (Electrobun Experimental)";
const INTERNAL_NAME = "KodoCodeElectrobun";
const COMPANY_NAME = "Kodo Code";

function getRequiredEnv(name) {
  const value = process.env[name] && process.env[name].trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getIconPath() {
  const sourceRoot = Path.resolve(__dirname, "../../..");
  return Path.join(sourceRoot, "assets/prod/kodo-black-windows.ico");
}

function getExecutablePaths() {
  const buildDir = getRequiredEnv("ELECTROBUN_BUILD_DIR");
  const appName = getRequiredEnv("ELECTROBUN_APP_NAME");
  const binDir = Path.join(buildDir, appName, "bin");
  return [Path.join(binDir, "launcher.exe"), Path.join(binDir, "bun.exe")];
}

async function patchExecutable(executablePath, iconPath, version) {
  if (!FS.existsSync(executablePath)) {
    return;
  }

  const originalFilename = Path.basename(executablePath);
  await rcedit(executablePath, {
    icon: iconPath,
    "file-version": version,
    "product-version": version,
    "version-string": {
      CompanyName: COMPANY_NAME,
      FileDescription: APP_NAME,
      ProductName: APP_NAME,
      InternalName: INTERNAL_NAME,
      OriginalFilename: originalFilename,
    },
  });
}

async function main() {
  if (process.platform !== "win32" || process.env.ELECTROBUN_OS !== "win") {
    return;
  }

  const iconPath = getIconPath();
  if (!FS.existsSync(iconPath)) {
    throw new Error(`Electrobun Windows icon not found: ${iconPath}`);
  }

  const version = (process.env.ELECTROBUN_APP_VERSION || "").trim() || "0.0.1";
  for (const executablePath of getExecutablePaths()) {
    await patchExecutable(executablePath, iconPath, version);
  }
}

main().catch((error) => {
  console.error("[electrobun-postbuild-node] failed to patch Windows executable metadata", error);
  process.exit(1);
});
