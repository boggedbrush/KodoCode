#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const workspaces = [
  "packages/contracts",
  "packages/shared",
  "apps/web",
  "apps/server",
  "apps/desktop",
  "scripts",
];

const bunCommand = process.env.BUN_BINARY ?? "bun";

for (const workspace of workspaces) {
  const result = spawnSync(bunCommand, ["run", "typecheck"], {
    cwd: new URL(`../${workspace}/`, import.meta.url),
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
    windowsHide: false,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
