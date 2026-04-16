import * as ChildProcess from "node:child_process";
import * as Path from "node:path";

function main() {
  if (process.platform !== "win32" || process.env.ELECTROBUN_OS !== "win") {
    return;
  }

  const scriptPath = Path.join(import.meta.dir, "patch-windows-metadata.cjs");
  const result = ChildProcess.spawnSync("node", [scriptPath], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`Node metadata patch failed with exit code ${result.status}`);
  }
}

try {
  main();
} catch (error) {
  console.error("[electrobun-postbuild] failed to patch Windows executable metadata", error);
  process.exit(1);
}
