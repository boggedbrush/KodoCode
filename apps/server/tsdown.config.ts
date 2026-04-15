import { defineConfig } from "tsdown";

// Keep release artifacts lean by default; opt in when debugging packaged builds.
const emitSourcemaps =
  process.env.T3CODE_SERVER_SOURCEMAP?.trim() === "1" ||
  process.env.T3CODE_SERVER_SOURCEMAP?.trim().toLowerCase() === "true";

export default defineConfig({
  entry: ["src/bin.ts"],
  format: ["esm", "cjs"],
  checks: {
    legacyCjs: false,
  },
  outDir: "dist",
  sourcemap: emitSourcemaps,
  clean: true,
  noExternal: (id) => id.startsWith("@t3tools/"),
  inlineOnly: false,
  banner: {
    js: "#!/usr/bin/env node\n",
  },
});
