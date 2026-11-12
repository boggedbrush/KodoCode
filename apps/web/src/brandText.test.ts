// @effect-diagnostics nodeBuiltinImport:off -- Reads the source files whose text the plugin preserves.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { APP_BASE_NAME, APP_REPOSITORY_URL } from "@t3tools/shared/appBrand";
import { describe, expect, it } from "vite-plus/test";

import { brandTextPlugin, PRESERVED_TEXT, REPOINTED_TEXT } from "../vite/brandText";
import { resolveVersionMismatch } from "./versionSkew";

type Transform = (code: string, id: string) => { code: string } | null;

// Built by concatenation: this file is itself transformed, so a literal would be rewritten.
const UPSTREAM_NAME = ["T3", "Code"].join(" ");
const repoRoot = NodePath.resolve(import.meta.dirname, "../../..");

const transform = (code: string, id: string) => {
  const hook = brandTextPlugin().transform as Transform | { handler: Transform };
  return (typeof hook === "function" ? hook : hook.handler)(code, id);
};

describe("brandTextPlugin", () => {
  it("swaps the product name in web source only", () => {
    expect(transform(`const a = "${UPSTREAM_NAME}";`, "/repo/apps/web/src/a.tsx")?.code).toBe(
      `const a = "${APP_BASE_NAME}";`,
    );
    expect(
      transform(`const a = "${UPSTREAM_NAME}";`, "/repo/apps/web/src/a.ts?t=1"),
    ).not.toBeNull();
    expect(
      transform(
        `a("https://x/?name=${UPSTREAM_NAME.replace(" ", "%20")}")`,
        "/repo/apps/web/src/a.ts",
      )?.code,
    ).toBe(`a("https://x/?name=${encodeURIComponent(APP_BASE_NAME)}")`);
    // Modules other processes load as well must read the same everywhere.
    for (const other of [
      "/repo/apps/server/src/a.ts",
      "/repo/apps/desktop/src/a.ts",
      "/repo/packages/shared/src/a.ts",
      "/repo/packages/client-runtime/src/a.ts",
      "/repo/packages/contracts/src/a.ts",
      "/repo/node_modules/x/apps/web/src/a.js",
      "/repo/apps/web/src/a.json",
    ]) {
      expect(transform(`const a = "${UPSTREAM_NAME}";`, other)).toBeNull();
    }
  });

  it("leaves identifiers, storage keys and schemes alone", () => {
    const code = 'a("t3code:theme"); b("T3CODE_HOME"); c("t3code://x"); d("@t3tools/shared");';
    expect(transform(code, "/repo/apps/web/src/a.ts")).toBeNull();
  });

  it("keeps upstream's name where the text must match what upstream generates", () => {
    const revoke = `Revoke "${UPSTREAM_NAME} · …" in`;
    const source = `a(\`Link ${UPSTREAM_NAME}. ${revoke} there\`);`;
    expect(
      transform(source, "/repo/apps/web/src/components/settings/LinkedEnvironmentsSettings.tsx")
        ?.code,
    ).toBe(`a(\`Link ${APP_BASE_NAME}. ${revoke} there\`);`);
    // The exclusion belongs to its file: the same text elsewhere is rewritten.
    expect(transform(source, "/repo/apps/web/src/other.tsx")?.code).toBe(
      `a(\`Link ${APP_BASE_NAME}. Revoke "${APP_BASE_NAME} · …" in there\`);`,
    );
  });

  it("points the boot error issue link at this fork", () => {
    const upstream = "https://github.com/pingdotgg/t3code/issues/new";
    expect(transform(`const U = "${upstream}";`, "/repo/apps/web/src/lib/bootError.ts")?.code).toBe(
      `const U = "${APP_REPOSITORY_URL}/issues/new";`,
    );
    expect(transform(`const U = "${upstream}";`, "/repo/apps/web/src/other.ts")).toBeNull();
  });

  it("preserves or repoints only text that still exists in its source file", () => {
    for (const entry of [...PRESERVED_TEXT, ...REPOINTED_TEXT]) {
      const source = NodeFS.readFileSync(NodePath.join(repoRoot, entry.file), "utf8");
      expect(source, `${entry.file}: ${entry.text}`).toContain(entry.text);
    }
  });

  it("is applied by the test runner to real source modules", () => {
    const mismatch = resolveVersionMismatch("0.0.1", "9.9.9");
    expect(mismatch?.hint).toContain(APP_BASE_NAME);
    expect(mismatch?.hint).not.toContain(UPSTREAM_NAME);
  });
});
