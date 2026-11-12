import { assert, describe, it } from "@effect/vitest";

import { findReviewItems, findRunLiteralsWithoutSnapshot } from "./reviewItems.ts";
import { makeManifest } from "./testing.ts";

const manifest = makeManifest({
  hooks: [
    { file: "apps/server/src/guard.ts", hooks: ["guard"] },
    { file: "apps/web/src/brand.ts", hooks: ["brand"] },
  ],
});

const review = (changes: Parameters<typeof findReviewItems>[0]["changes"], serverDiff = "") =>
  findReviewItems({ manifest, changes, serverDiff }).map((item) => item.message);

describe("review items", () => {
  it("flags edits to hooked enforcement files but not branding or deleted ones", () => {
    const items = review([
      { status: "M", path: "apps/server/src/guard.ts" },
      { status: "M", path: "apps/web/src/brand.ts" },
      { status: "M", path: "apps/server/src/other.ts" },
    ]);
    assert.strictEqual(items.length, 1);
    assert.include(items[0], "apps/server/src/guard.ts carries Kodo hooks");
    assert.deepStrictEqual(review([{ status: "D", path: "apps/server/src/guard.ts" }]), []);
  });

  it("flags new provider packages, adapters and drivers but not their tests", () => {
    const items = review([
      { status: "A", path: "packages/provider-x/package.json" },
      { status: "A", path: "apps/server/src/orchestration-v2/Adapters/XAdapterV2.ts" },
      { status: "A", path: "apps/server/src/provider/XDriver.ts" },
      { status: "A", path: "apps/server/src/orchestration-v2/Adapters/XAdapterV2.test.ts" },
      { status: "A", path: "apps/server/src/orchestration-v2/Adapters/XAdapterV2.testkit.ts" },
      { status: "M", path: "apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts" },
    ]);
    assert.strictEqual(items.length, 3);
  });

  it("reads added MCP tools and run literals from the diff, skipping tests", () => {
    const diff = [
      "+++ b/apps/server/src/mcp/toolkits/x/tools.ts",
      '+const A = Tool.make("t3_a", {',
      '-const Old = Tool.make("t3_old", {',
      "+++ b/apps/server/src/orchestration-v2/Orchestrator.ts",
      "+    const run: OrchestrationV2Run = {",
      "+++ b/apps/server/src/mcp/Thing.test.ts",
      '+const T = Tool.make("t3_in_test", {',
      "+  const r: OrchestrationV2Run = {",
    ].join("\n");
    const items = review([], diff);
    assert.strictEqual(items.length, 2);
    assert.include(items[0], "t3_a");
    assert.notInclude(items[0], "t3_old");
    assert.notInclude(items[0], "t3_in_test");
    assert.include(items[1], "1 new run-creation site");
  });

  it("finds run literals with no snapshot in the next lines", () => {
    const ok = "const run: OrchestrationV2Run = {\n  id,\n  ...kodoRunModeSnapshot(mode),\n};\n";
    const copy = "const run: OrchestrationV2Run = {\n  ...previous,\n  status: 1,\n};\n";
    const bad = "x\nconst run: OrchestrationV2Run = {\n  id,\n};\n";
    assert.deepStrictEqual(
      findRunLiteralsWithoutSnapshot([
        { path: "a.ts", text: ok },
        { path: "b.ts", text: bad },
        { path: "d.ts", text: copy },
        { path: "c.test.ts", text: bad },
      ]),
      ["b.ts:2"],
    );
  });
});
