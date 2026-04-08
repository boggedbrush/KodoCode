import { spawn } from "node:child_process";

import { desktopDir, resolveElectronPath } from "./electron-launcher.mjs";

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
const DEVTOOLS_ARG = "--devtools";
const forwardDevtools = process.argv.includes(DEVTOOLS_ARG);
const electronArgs = ["dist-electron/main.js", ...(forwardDevtools ? [DEVTOOLS_ARG] : [])];

const child = spawn(resolveElectronPath(), electronArgs, {
  stdio: "inherit",
  cwd: desktopDir,
  env: childEnv,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
