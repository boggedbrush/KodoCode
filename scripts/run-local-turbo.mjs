#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const candidatePaths =
  process.platform === "win32"
    ? [
        join(repoRoot, "node_modules", ".bin", "turbo.exe"),
        join(repoRoot, "node_modules", ".bin", "turbo.cmd"),
      ]
    : [join(repoRoot, "node_modules", ".bin", "turbo")];

const turboPath = candidatePaths.find((candidate) => existsSync(candidate));

if (!turboPath) {
  console.error("Unable to find local turbo binary in node_modules/.bin");
  process.exit(1);
}

const result = spawnSync(turboPath, process.argv.slice(2), {
  stdio: "inherit",
  cwd: repoRoot,
  windowsHide: false,
});

if (result.error) {
  throw result.error;
}

if (result.status !== null) {
  process.exit(result.status);
}

process.kill(process.pid, result.signal ?? "SIGTERM");
