import { assert, describe, it } from "@effect/vitest";

import {
  applyOverlay,
  checkHooks,
  findOwnedPathViolations,
  hookPresent,
  runLeakChecks,
} from "./overlay.ts";
import { buildCheckReport } from "./report.ts";
import type { KodoManifestInput } from "./manifest.ts";
import { makeManifest, memoryIo, textOf } from "./testing.ts";

const statusOf = (results: ReturnType<typeof applyOverlay>, id: string) =>
  results.find((result) => result.id === id)?.status;

describe("asset copies", () => {
  const manifest = makeManifest({
    assets: [
      { id: "icon", source: "kodo/icon.png", destinations: ["assets/icon.png", "web/icon.png"] },
    ],
  });

  it("copies, then reports already-applied on the second run", () => {
    const io = memoryIo({ "kodo/icon.png": "KODO", "assets/icon.png": "T3", "web/icon.png": "T3" });
    assert.strictEqual(statusOf(applyOverlay(manifest, io, { write: true }), "icon"), "applied");
    assert.strictEqual(textOf(io, "web/icon.png"), "KODO");
    io.writes.length = 0;
    assert.strictEqual(
      statusOf(applyOverlay(manifest, io, { write: true }), "icon"),
      "already-applied",
    );
    assert.deepStrictEqual(io.writes, []);
  });

  it("check mode reports pending and writes nothing", () => {
    const io = memoryIo({
      "kodo/icon.png": "KODO",
      "assets/icon.png": "T3",
      "web/icon.png": "KODO",
    });
    assert.strictEqual(statusOf(applyOverlay(manifest, io, { write: false }), "icon"), "pending");
    assert.deepStrictEqual(io.writes, []);
  });

  it("names the entry when the destination directory moved", () => {
    const io = memoryIo({ "kodo/icon.png": "KODO", "web/icon.png": "T3", "brand/icon.png": "T3" });
    const [result] = applyOverlay(manifest, io, { write: true });
    assert.strictEqual(result?.status, "target-missing");
    assert.include(result?.details.join("\n"), 'assets "icon"');
    assert.include(result?.details.join("\n"), "assets/ no longer exists");
    // The reachable destination was still written.
    assert.strictEqual(textOf(io, "web/icon.png"), "KODO");
  });

  it("flags a renamed destination file unless allowCreate is set", () => {
    const io = memoryIo({
      "kodo/icon.png": "KODO",
      "assets/other.png": "T3",
      "web/icon.png": "T3",
    });
    const [result] = applyOverlay(manifest, io, { write: true });
    assert.strictEqual(result?.status, "target-missing");
    assert.include(result?.details.join("\n"), "renamed or removed");
    const creating = makeManifest({
      assets: [
        {
          id: "icon",
          source: "kodo/icon.png",
          destinations: ["assets/new.png"],
          allowCreate: true,
        },
      ],
    });
    assert.strictEqual(statusOf(applyOverlay(creating, io, { write: true }), "icon"), "applied");
    assert.strictEqual(textOf(io, "assets/new.png"), "KODO");
  });

  it("reports a missing Kodo source", () => {
    const io = memoryIo({ "assets/icon.png": "T3" });
    const [result] = applyOverlay(manifest, io, { write: true });
    assert.strictEqual(result?.status, "source-missing");
    assert.include(result?.details.join("\n"), "kodo/icon.png does not exist");
  });
});

describe("replacements", () => {
  const entry: KodoManifestInput["replacements"][number] = {
    id: "name",
    files: ["src/**/*.tsx"],
    find: "T3 Code",
    replace: "Kodo",
    expect: "at-least-one",
  };

  it("applies across files and is idempotent", () => {
    const manifest = makeManifest({ replacements: [entry] });
    const io = memoryIo({
      "src/a.tsx": "T3 Code and T3 Code",
      "src/b.tsx": "x",
      "src/c.ts": "T3 Code",
    });
    const first = applyOverlay(manifest, io, { write: true });
    assert.strictEqual(statusOf(first, "name"), "applied");
    assert.strictEqual(textOf(io, "src/a.tsx"), "Kodo and Kodo");
    assert.strictEqual(textOf(io, "src/c.ts"), "T3 Code");
    io.writes.length = 0;
    assert.strictEqual(
      statusOf(applyOverlay(manifest, io, { write: true }), "name"),
      "already-applied",
    );
    assert.deepStrictEqual(io.writes, []);
  });

  it("reports target-missing when the text vanished upstream, naming the entry", () => {
    const manifest = makeManifest({ replacements: [entry] });
    const io = memoryIo({ "src/a.tsx": "Totally new copy" });
    const [result] = applyOverlay(manifest, io, { write: true });
    assert.strictEqual(result?.status, "target-missing");
    assert.include(result?.details.join("\n"), 'replacements "name"');
    assert.include(result?.details.join("\n"), '"T3 Code" was not found');
  });

  it("reports target-missing when no file matches any more", () => {
    const manifest = makeManifest({ replacements: [{ ...entry, files: ["src/gone.tsx"] }] });
    const [result] = applyOverlay(manifest, memoryIo({ "src/a.tsx": "T3 Code" }), { write: true });
    assert.strictEqual(result?.status, "target-missing");
    assert.include(result?.details.join("\n"), "no file matches");
  });

  it("enforces an exact count and writes nothing on a mismatch", () => {
    const manifest = makeManifest({ replacements: [{ ...entry, expect: 3 }] });
    const io = memoryIo({ "src/a.tsx": "T3 Code T3 Code" });
    const [result] = applyOverlay(manifest, io, { write: true });
    assert.strictEqual(result?.status, "mismatch");
    assert.include(result?.details.join("\n"), 'found "T3 Code" 2 time(s) but expected 3');
    assert.deepStrictEqual(io.writes, []);
  });

  it("is already-applied with an exact count once the replacement is present that often", () => {
    const manifest = makeManifest({ replacements: [{ ...entry, expect: 2 }] });
    const io = memoryIo({ "src/a.tsx": "T3 Code T3 Code" });
    assert.strictEqual(statusOf(applyOverlay(manifest, io, { write: true }), "name"), "applied");
    assert.strictEqual(
      statusOf(applyOverlay(manifest, io, { write: true }), "name"),
      "already-applied",
    );
  });

  it("ignores placeholders", () => {
    const manifest = makeManifest({ replacements: [{ ...entry, todo: "fill in" }] });
    const io = memoryIo({ "src/a.tsx": "T3 Code" });
    assert.strictEqual(
      statusOf(applyOverlay(manifest, io, { write: true }), "name"),
      "placeholder",
    );
    assert.deepStrictEqual(io.writes, []);
  });
});

describe("json edits", () => {
  const manifest = makeManifest({
    jsonEdits: [
      {
        id: "app",
        file: "pkg.json",
        set: [
          { path: ["build", "appId"], value: "com.kodo" },
          { path: ["productName"], value: "Kodo" },
        ],
      },
    ],
  });

  it("edits by key path, keeps formatting, and is idempotent", () => {
    const io = memoryIo({
      "pkg.json":
        '{\n  "productName": "T3",\n  "build": { "appId": "com.t3", "files": ["a", "b"] }\n}\n',
    });
    assert.strictEqual(statusOf(applyOverlay(manifest, io, { write: true }), "app"), "applied");
    assert.strictEqual(
      textOf(io, "pkg.json"),
      '{\n  "productName": "Kodo",\n  "build": { "appId": "com.kodo", "files": ["a", "b"] }\n}\n',
    );
    assert.strictEqual(
      statusOf(applyOverlay(manifest, io, { write: true }), "app"),
      "already-applied",
    );
  });

  it("names the missing key path and changes nothing", () => {
    const io = memoryIo({ "pkg.json": '{ "productName": "T3", "packager": {} }' });
    const [result] = applyOverlay(manifest, io, { write: true });
    assert.strictEqual(result?.status, "target-missing");
    assert.include(result?.details.join("\n"), "key path build does not exist");
    assert.deepStrictEqual(io.writes, []);
  });

  it("reports a missing file", () => {
    const [result] = applyOverlay(manifest, memoryIo({}), { write: true });
    assert.strictEqual(result?.status, "target-missing");
    assert.include(result?.details.join("\n"), "pkg.json does not exist");
  });
});

describe("hooks", () => {
  const hooks: KodoManifestInput["hooks"] = [
    { file: "src/a.ts", hooks: ["mode-resolver", "mode"] },
  ];

  it("matches whole hook names only", () => {
    assert.isTrue(hookPresent("// KODO: mode-resolver - x", "mode-resolver"));
    assert.isFalse(hookPresent("// KODO: mode-resolver - x", "mode"));
    assert.isTrue(hookPresent("x(); // KODO:mode", "mode"));
  });

  it("matches free-text brand markers, including before a full stop", () => {
    assert.isTrue(
      hookPresent(
        "// KODO: default feed is the fork repository.",
        "default feed is the fork repository",
      ),
    );
    assert.isTrue(hookPresent("/* KODO: a (b) */", "a (b)"));
    assert.isFalse(hookPresent("// KODO: default feed", "default feed is the fork repository"));
  });

  it("reports lost hooks, and a deleted file with a rename hint", () => {
    const lost = checkHooks(hooks, memoryIo({ "src/a.ts": "// KODO: mode-resolver" }));
    assert.strictEqual(lost[0]?.status, "missing-hooks");
    assert.deepStrictEqual(lost[0]?.missing, ["mode"]);
    const gone = checkHooks(hooks, memoryIo({}));
    assert.strictEqual(gone[0]?.status, "missing-file");
    assert.include(gone[0]?.details.join("\n"), "deleted or renamed");
  });
});

describe("leak checks", () => {
  const leakCheck: KodoManifestInput["leakChecks"][number] = {
    id: "brand",
    files: ["src/**/*.tsx"],
    forbid: [{ text: "T3 Code" }, { regex: "t3\\s?chat", flags: "gi" }],
    allow: [{ file: "src/legal/**" }, { text: "Based on T3 Code" }],
  };

  it("finds leaks with file and line, honouring the allowlist", () => {
    const io = memoryIo({
      "src/a.tsx": "ok\nWelcome to T3 Code\nT3Chat too\nBased on T3 Code",
      "src/legal/b.tsx": "T3 Code",
    });
    const [result] = runLeakChecks([leakCheck], io);
    assert.strictEqual(result?.status, "leaks");
    assert.deepStrictEqual(
      result?.hits.map((hit) => `${hit.file}:${hit.line}`),
      ["src/a.tsx:2", "src/a.tsx:3"],
    );
    assert.strictEqual(result?.allowedCount, 2);
  });

  it("fails a check whose globs match nothing", () => {
    const [result] = runLeakChecks([leakCheck], memoryIo({ "other.txt": "x" }));
    assert.strictEqual(result?.status, "no-files");
  });
});

describe("kodo-owned paths", () => {
  it("flags upstream files under owned paths", () => {
    const violations = findOwnedPathViolations(
      [
        { path: "kodo/" },
        { path: "docs/mine.md" },
        { path: "future/", todo: "later" },
        { path: "README.md", upstreamHasIt: true },
      ],
      ["kodo/new.ts", "docs/mine.md", "docs/other.md", "future/x", "README.md"],
    );
    assert.deepStrictEqual(violations, [
      { file: "kodo/new.ts", owned: "kodo/" },
      { file: "docs/mine.md", owned: "docs/mine.md" },
    ]);
  });
});

describe("buildCheckReport", () => {
  it("collects one problem line per failure and passes a clean tree", () => {
    const manifest = makeManifest({
      replacements: [
        { id: "name", files: ["a.ts"], find: "T3", replace: "Kodo", expect: "at-least-one" },
      ],
      hooks: [{ file: "a.ts", hooks: ["h"] }],
    });
    const bad = buildCheckReport(manifest, memoryIo({ "a.ts": "T3" }));
    assert.deepStrictEqual(
      bad.problems.map((problem) => problem.slice(0, 20)),
      ['replacement "name" i', 'hooks: a.ts lost "KO'],
    );
    const good = buildCheckReport(manifest, memoryIo({ "a.ts": "Kodo // KODO: h" }));
    assert.deepStrictEqual(good.problems, []);
  });
});
