import { assert, describe, it } from "@effect/vitest";

import { normalizedTokens, transformBrandLiterals } from "./brandCodemod.ts";
import { evaluateBrandCodemod, isCodemodOutput } from "./brandCodemodRun.ts";
import { classifyConflict } from "./conflicts.ts";
import type { BrandCodemodConfig } from "./manifest.ts";
import { makeManifest, memoryIo, textOf } from "./testing.ts";
import { diffTokens } from "./tokenDiff.ts";

const options = {
  brand: "T3 Code",
  expression: "APP_BASE_NAME",
  importName: "APP_BASE_NAME",
  importFrom: "@t3tools/shared/appBrand",
  keepTexts: [] as string[],
};
const IMPORT = 'import { APP_BASE_NAME } from "@t3tools/shared/appBrand";';
const run = (source: string, overrides: Partial<typeof options> = {}) =>
  transformBrandLiterals(source, "src/a.ts", { ...options, ...overrides });

describe("brand codemod rewrites", () => {
  it("turns string literals into templates and adds the import after the last import", () => {
    const result = run(
      'import { a } from "./a.ts";\nimport { b } from "./b.ts";\nexport { c } from "./c.ts";\nconst m = "T3 Code failed";\nconst n = \'T3 Code is "great"\';\n',
    );
    assert.strictEqual(
      result.output,
      `import { a } from "./a.ts";\nimport { b } from "./b.ts";\n${IMPORT}\nexport { c } from "./c.ts";\nconst m = \`\${APP_BASE_NAME} failed\`;\nconst n = \`\${APP_BASE_NAME} is "great"\`;\n`,
    );
    assert.strictEqual(result.rewritten, 2);
    assert.deepStrictEqual(result.reports, []);
  });

  it("escapes template-special characters and keeps other escapes", () => {
    const result = run('import { a } from "./a.ts";\nconst m = "T3 Code `x` ${y} \\"q\\"\\n";\n');
    assert.include(result.output, 'const m = `${APP_BASE_NAME} \\`x\\` \\${y} "q"\\n`;');
  });

  it("rewrites template literals in place, including every part of a template expression", () => {
    const result = run(
      "import { a } from './a.ts';\nconst x = `T3 Code ${a} and T3 Code ${b} end T3 Code`;\nconst y = `plain T3 Code`;\n",
    );
    assert.include(
      result.output,
      "const x = `${APP_BASE_NAME} ${a} and ${APP_BASE_NAME} ${b} end ${APP_BASE_NAME}`;",
    );
    assert.include(result.output, "const y = `plain ${APP_BASE_NAME}`;");
    assert.strictEqual(result.rewritten, 2);
  });

  it("rewrites literals nested inside template expressions", () => {
    const result = run('import { a } from "./a.ts";\nconst x = `${f("T3 Code")} tail`;\n');
    assert.include(result.output, "const x = `${f(`${APP_BASE_NAME}`)} tail`;");
  });

  it("is idempotent", () => {
    const once = run(
      'import { a } from "./a.ts";\nconst m = "T3 Code";\nconst n = `T3 Code ${a}`;\n',
    );
    const twice = run(once.output);
    assert.strictEqual(twice.output, once.output);
    assert.strictEqual(twice.rewritten, 0);
  });
});

describe("brand codemod import handling", () => {
  it("adds the name to an existing import of the module, in sorted position", () => {
    const sorted = run(
      'import { APP_RELEASES_URL, Z_LAST } from "@t3tools/shared/appBrand";\nconst m = "T3 Code";\n',
    );
    assert.include(
      sorted.output,
      'import { APP_BASE_NAME, APP_RELEASES_URL, Z_LAST } from "@t3tools/shared/appBrand";',
    );
    const end = run(
      'import { ABC_FIRST } from "@t3tools/shared/appBrand";\nconst m = "T3 Code";\n',
    );
    assert.include(
      end.output,
      'import { ABC_FIRST, APP_BASE_NAME } from "@t3tools/shared/appBrand";',
    );
  });

  it("does nothing to imports when the name is already imported", () => {
    const source = `${IMPORT}\nconst m = "T3 Code";\n`;
    assert.strictEqual(run(source).output, `${IMPORT}\nconst m = \`\${APP_BASE_NAME}\`;\n`);
  });

  it("puts the import first in a file with no imports, after a shebang", () => {
    assert.strictEqual(
      run('const m = "T3 Code";\n').output,
      `${IMPORT}\nconst m = \`\${APP_BASE_NAME}\`;\n`,
    );
    assert.isTrue(
      run('#!/usr/bin/env node\nconst m = "T3 Code";\n').output.startsWith(
        "#!/usr/bin/env node\nimport",
      ),
    );
  });

  it("reports and leaves the file alone when the name is taken by something else", () => {
    const declared = run('const APP_BASE_NAME = "T3 Code";\nconst m = "T3 Code x";\n');
    assert.strictEqual(declared.rewritten, 0);
    assert.include(declared.reports[0]?.reason, "is declared in this file");
    const imported = run('import { APP_BASE_NAME } from "./elsewhere.ts";\nconst m = "T3 Code";\n');
    assert.include(imported.reports[0]?.reason, "already imported from ./elsewhere.ts");
    assert.strictEqual(imported.output.includes("`"), false);
  });
});

describe("brand codemod skip rules", () => {
  const untouched = (source: string) => {
    const result = run(source);
    assert.strictEqual(result.output, source);
    assert.strictEqual(result.rewritten, 0);
    return result;
  };

  it("skips comments, regex literals, import specifiers, object keys and types silently", () => {
    const result = untouched(
      [
        'import x from "T3 Code";',
        'export * from "T3 Code";',
        "// T3 Code in a comment",
        "/* T3 Code */ const r = /T3 Code/u;",
        'const o = { "T3 Code": 1, k: 2 };',
        'type Brand = "T3 Code";',
        'interface I { "T3 Code": string }',
        'enum E { "T3 Code" = 1 }',
        "",
      ].join("\n"),
    );
    assert.deepStrictEqual(result.reports, []);
  });

  it("reports comparisons, switch cases, searches, factories, const assertions and tagged templates", () => {
    const cases: ReadonlyArray<[string, string]> = [
      ['if (name === "T3 Code") {}', "comparison"],
      ['if ("T3 Code" !== name) {}', "comparison"],
      ['switch (n) { case "T3 Code": break; }', "switch case"],
      ['s.includes("T3 Code");', "includes()"],
      ['new RegExp("T3 Code");', "RegExp()"],
      ['Schema.Literal("T3 Code");', "Literal()"],
      ['const v = "T3 Code" as const;', "const assertion"],
      ["const v = tag`T3 Code`;", "tagged template"],
      ['const v = o["T3 Code"];', "element access"],
    ];
    for (const [source, reason] of cases) {
      const result = untouched(source);
      assert.lengthOf(result.reports, 1, source);
      assert.include(result.reports[0]?.reason, reason);
    }
  });

  it("rewrites the safe literals of a file and reports the unsafe ones", () => {
    const result = run(
      'import { a } from "./a.ts";\nconst ok = "T3 Code";\nif (n === "T3 Code") {}\n',
    );
    assert.strictEqual(result.rewritten, 1);
    assert.lengthOf(result.reports, 1);
    assert.strictEqual(result.reports[0]?.line, 3);
    assert.include(result.output, 'n === "T3 Code"');
  });

  it("keeps literals matching a keep text and counts them", () => {
    const source =
      'import { a } from "./a.ts";\nconst marker = "Written by T3 Code";\nconst m = "T3 Code";\n';
    const result = run(source, { keepTexts: ["Written by"] });
    assert.include(result.output, 'const marker = "Written by T3 Code";');
    assert.include(result.output, "const m = `${APP_BASE_NAME}`;");
    assert.strictEqual(result.kept, 1);
  });
});

describe("normalized tokens", () => {
  it("ignores formatting, trailing commas and comments", () => {
    const a = "f(\n  `x ${y}`,\n  z,\n);\n// note\nconst o = { a: 1, };";
    const b = "f(`x ${y}`, z); const o = {a: 1};";
    assert.deepStrictEqual(normalizedTokens(a), normalizedTokens(b));
  });

  it("tells different code apart and locates the difference", () => {
    const hunks = diffTokens(
      normalizedTokens("a(1); b(2); c(3);"),
      normalizedTokens("a(1); b(5); c(3); d();"),
    );
    assert.lengthOf(hunks ?? [], 2);
  });
});

describe("evaluateBrandCodemod", () => {
  const config: BrandCodemodConfig = {
    ...options,
    files: ["src/**/*.ts"],
    exclude: ["**/*.test.ts"],
    keep: [
      { file: "src/legacy.ts", why: "legacy names" },
      { file: "src/shim.ts", text: "Written by", why: "marker" },
    ],
  };
  const files = {
    "src/a.ts": 'import { b } from "./b.ts";\nexport const m = "T3 Code failed";\n',
    "src/a.test.ts": 'export const t = "T3 Code";\n',
    "src/legacy.ts": 'export const old = "T3 Code (Alpha)";\n',
    "src/shim.ts": 'import { b } from "./b.ts";\nexport const M = "Written by T3 Code";\n',
    "src/bad.ts": 'import { b } from "./b.ts";\nexport const ok = b === "T3 Code";\n',
    "src/clean.ts": "export const fine = 1;\n",
    "other/x.ts": 'export const o = "T3 Code";\n',
  };

  it("check mode reports pending rewrites and writes nothing", () => {
    const io = memoryIo(files);
    const results = evaluateBrandCodemod(config, io, false);
    assert.deepStrictEqual(
      results.map((result) => `${result.id}:${result.status}`),
      ["src/a.ts:pending", "src/bad.ts:mismatch"],
    );
    assert.include(results[1]?.details.join("\n"), "src/bad.ts:2: string used in a comparison");
    assert.deepStrictEqual(io.writes, []);
  });

  it("apply mode writes, honours keeps and test exclusion, and is idempotent", () => {
    const io = memoryIo(files);
    evaluateBrandCodemod(config, io, true);
    assert.include(textOf(io, "src/a.ts"), "`${APP_BASE_NAME} failed`");
    assert.strictEqual(textOf(io, "src/legacy.ts"), files["src/legacy.ts"]);
    assert.strictEqual(textOf(io, "src/shim.ts"), files["src/shim.ts"]);
    assert.strictEqual(textOf(io, "src/a.test.ts"), files["src/a.test.ts"]);
    assert.strictEqual(textOf(io, "other/x.ts"), files["other/x.ts"]);
    io.writes.length = 0;
    const again = evaluateBrandCodemod(config, io, true);
    assert.deepStrictEqual(io.writes, []);
    assert.deepStrictEqual(
      again.map((result) => result.id),
      ["src/bad.ts"],
    );
  });

  it("is inert while the section carries a todo", () => {
    const [result] = evaluateBrandCodemod({ ...config, todo: "later" }, memoryIo(files), true);
    assert.strictEqual(result?.status, "placeholder");
  });
});

describe("codemod-owned conflicts", () => {
  const manifest = makeManifest({
    brandCodemod: {
      ...options,
      files: ["src/**/*.ts"],
      exclude: [],
      keep: [],
    },
    hooks: [{ file: "src/hooked.ts", hooks: ["h"] }],
  });
  const both = { hasBase: true, hasOurs: true, hasTheirs: true };
  const base = 'import { a } from "./a.ts";\nexport const m = "T3 Code failed";\n';
  const ours = `import { a } from "./a.ts";\n${IMPORT}\nexport const m =\n  \`\${APP_BASE_NAME} failed\`;\n`;

  it("takes upstream's version when ours is exactly the codemod's output", () => {
    assert.isTrue(
      isCodemodOutput(manifest.brandCodemod as BrandCodemodConfig, "src/a.ts", base, ours),
    );
    const result = classifyConflict({ path: "src/a.ts", ...both }, manifest, {
      isCodemodOwned: () => true,
    });
    assert.strictEqual(result.resolution.kind, "theirs");
    assert.include(
      result.resolution.kind === "theirs" ? result.resolution.why : "",
      "codemod-owned",
    );
  });

  it("leaves files with extra edits, hooks, or no base to a human", () => {
    const extra = ours.replace("failed", "failed!");
    assert.isFalse(
      isCodemodOutput(manifest.brandCodemod as BrandCodemodConfig, "src/a.ts", base, extra),
    );
    assert.strictEqual(
      classifyConflict({ path: "src/a.ts", ...both }, manifest, { isCodemodOwned: () => false })
        .resolution.kind,
      "manual",
    );
    assert.strictEqual(
      classifyConflict({ path: "src/hooked.ts", ...both }, manifest, { isCodemodOwned: () => true })
        .resolution.kind,
      "manual",
    );
    assert.strictEqual(
      classifyConflict({ path: "src/a.ts", ...both, hasBase: false }, manifest, {
        isCodemodOwned: () => true,
      }).resolution.kind,
      "manual",
    );
  });
});
