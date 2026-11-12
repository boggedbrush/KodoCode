import { assert, describe, it } from "@effect/vitest";

import { classifyConflict, classifyConflicts, parseUnmergedIndex } from "./conflicts.ts";
import { makeManifest } from "./testing.ts";
import { findTouchpoints, parseNameStatusZ } from "./touchpoints.ts";

const manifest = makeManifest({
  assets: [{ id: "icon", source: "kodo/i.png", destinations: ["assets/i.png"] }],
  replacements: [
    { id: "name", files: ["src/**/*.ts"], find: "T3", replace: "Kodo", expect: "at-least-one" },
  ],
  hooks: [{ file: "src/hooked.ts", hooks: ["mode"] }],
  jsonEdits: [{ id: "pkg", file: "package.json", set: [{ path: ["name"], value: "kodo" }] }],
  kodoOwned: [{ path: "kodo/" }],
});

const both = { hasBase: true, hasOurs: true, hasTheirs: true };

describe("classifyConflict", () => {
  it("lets ours win on Kodo-owned paths, including add/add", () => {
    const result = classifyConflict(
      { path: "kodo/a.ts", hasBase: false, hasOurs: true, hasTheirs: true },
      manifest,
    );
    assert.strictEqual(result.resolution.kind, "ours");
  });

  it("takes upstream's lockfile and asks for a reinstall", () => {
    const result = classifyConflict({ path: "pnpm-lock.yaml", ...both }, manifest);
    assert.deepStrictEqual(
      result.resolution.kind === "theirs" ? result.resolution.followUp : undefined,
      "reinstall",
    );
  });

  it("regenerates asset destinations only when both sides still have the file", () => {
    const ok = classifyConflict({ path: "assets/i.png", ...both }, manifest);
    assert.strictEqual(ok.resolution.kind, "theirs");
    const deleted = classifyConflict({ path: "assets/i.png", ...both, hasTheirs: false }, manifest);
    assert.strictEqual(deleted.resolution.kind, "manual");
    assert.include(
      deleted.resolution.kind === "manual" ? deleted.resolution.why : "",
      "deleted or moved upstream",
    );
  });

  it("leaves everything else to a human, with overlay hints", () => {
    const hooked = classifyConflict({ path: "src/hooked.ts", ...both }, manifest);
    assert.strictEqual(hooked.resolution.kind, "manual");
    const hints = hooked.resolution.kind === "manual" ? hooked.resolution.hints.join("\n") : "";
    assert.include(hints, "KODO: mode");
    assert.include(hints, 'replacement "name"');
    const pkg = classifyConflict({ path: "package.json", ...both }, manifest);
    assert.include(
      pkg.resolution.kind === "manual" ? pkg.resolution.hints.join("\n") : "",
      'jsonEdits "pkg"',
    );
  });

  it("sorts and ignores placeholders", () => {
    const withTodo = makeManifest({ kodoOwned: [{ path: "x/", todo: "later" }] });
    const [first, second] = classifyConflicts(
      [
        { path: "z.ts", ...both },
        { path: "x/a.ts", ...both },
      ],
      withTodo,
    );
    assert.strictEqual(first?.path, "x/a.ts");
    assert.strictEqual(first?.resolution.kind, "manual");
    assert.strictEqual(second?.path, "z.ts");
  });
});

describe("parseUnmergedIndex", () => {
  it("reads stages from ls-files -u output", () => {
    const out = [
      "100644 aaa 1\ta.ts",
      "100644 bbb 2\ta.ts",
      "100644 ccc 3\ta.ts",
      "100644 ddd 2\tb.ts",
      "",
    ].join("\u0000");
    assert.deepStrictEqual(parseUnmergedIndex(out), [
      { path: "a.ts", hasBase: true, hasOurs: true, hasTheirs: true },
      { path: "b.ts", hasBase: false, hasOurs: true, hasTheirs: false },
    ]);
  });
});

describe("touchpoints", () => {
  it("parses name-status -z including renames", () => {
    assert.deepStrictEqual(parseNameStatusZ("M\0a.ts\0R100\0old.ts\0new.ts\0D\0gone.ts\0"), [
      { status: "M", path: "a.ts" },
      { status: "R", path: "new.ts", oldPath: "old.ts" },
      { status: "D", path: "gone.ts" },
    ]);
  });

  it("names the manifest entry for deleted, renamed and changed targets", () => {
    const touchpoints = findTouchpoints(
      manifest,
      parseNameStatusZ(
        "D\0src/hooked.ts\0R100\0assets/i.png\0assets2/i.png\0M\0package.json\0M\0pnpm-lock.yaml\0M\0src/other.ts\0",
      ),
    );
    const text = touchpoints.map((t) => `${t.severity}|${t.message}`).join("\n");
    assert.include(
      text,
      "attention|hooks src/hooked.ts: hooked file src/hooked.ts was deleted upstream.",
    );
    assert.include(
      text,
      'attention|assets "icon": asset destination assets/i.png was renamed upstream (now assets2/i.png)',
    );
    assert.include(
      text,
      'attention|replacements "name": replacement target src/hooked.ts was deleted upstream',
    );
    assert.include(text, 'info|jsonEdits "pkg": edited file package.json was changed upstream.');
    assert.include(text, "lockfile pnpm-lock.yaml was changed upstream");
    assert.include(
      text,
      'replacements "name": replacement target src/other.ts was changed upstream',
    );
  });
});
