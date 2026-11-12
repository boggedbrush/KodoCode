import { assert, describe, it } from "@effect/vitest";

import realManifest from "../../kodo/overlay.manifest.ts";
import { validateManifest } from "./manifest.ts";
import { globToRegExp, matchesGlob, matchesOwnedPath } from "./paths.ts";
import { makeManifest } from "./testing.ts";

const problemsOf = (input: unknown): ReadonlyArray<string> => {
  const result = validateManifest(input);
  return result.ok ? [] : result.problems;
};

const base = makeManifest();

describe("validateManifest", () => {
  it("accepts the committed manifest", () => {
    const result = validateManifest(realManifest);
    assert.isTrue(result.ok, result.ok ? "" : result.problems.join("\n"));
  });

  it("reports a shape error with the offending field", () => {
    const problems = problemsOf({ ...base, assets: [{ id: "a", source: "x" }] });
    assert.lengthOf(problems, 1);
    assert.include(problems[0], "destinations");
  });

  it("rejects duplicate ids, unsafe paths and self-matching replacements", () => {
    const problems = problemsOf({
      ...base,
      assets: [
        { id: "dup", source: "../escape.png", destinations: ["/abs.png"] },
        { id: "dup", source: "glob*.png", destinations: ["a\\b.png"] },
      ],
      replacements: [
        { id: "loop", files: ["a.ts"], find: "Kodo", replace: "Kodo Code", expect: "at-least-one" },
      ],
    });
    const text = problems.join("\n");
    assert.include(text, 'assets id "dup" is used more than once');
    assert.include(text, '"../escape.png"');
    assert.include(text, '"/abs.png" must be relative');
    assert.include(text, "not a glob");
    assert.include(text, "forward slashes");
    assert.include(text, 'replacements "loop": replace text contains the find text');
  });

  it("rejects bad hook names, bad regexes and empty allow entries", () => {
    const problems = problemsOf({
      ...base,
      hooks: [{ file: "a.ts", hooks: ["two\nlines"] }],
      leakChecks: [
        {
          id: "leak",
          files: ["a.ts"],
          forbid: [{ regex: "(" }],
          allow: [{}],
        },
      ],
    });
    const text = problems.join("\n");
    assert.include(text, "must be one line");
    assert.include(text, "regex /(/ is invalid");
    assert.include(text, "an allow entry needs a file or a text");
  });

  it("rejects non-JSON edit values", () => {
    const problems = problemsOf({
      ...base,
      jsonEdits: [{ id: "j", file: "p.json", set: [{ path: ["a"], value: () => 1 }] }],
    });
    assert.include(problems.join("\n"), "not JSON-serializable");
  });
});

describe("globs", () => {
  it("matches dot directories, brace sets and directory prefixes", () => {
    assert.isTrue(matchesGlob(".github/workflows/a.yml", ".github/**/*.yml"));
    assert.isTrue(matchesGlob("apps/web/src/a/b.tsx", "apps/web/src/**/*.{ts,tsx}"));
    assert.isTrue(matchesGlob("a.ts", "**/*.ts"));
    assert.isFalse(matchesGlob("a/b.ts", "*.ts"));
    assert.isTrue(matchesGlob("kodo/assets/x.png", "kodo/"));
    assert.isFalse(matchesGlob("kodo2/x.png", "kodo/"));
    assert.isTrue(globToRegExp("a.b").test("a.b"));
    assert.isFalse(globToRegExp("a.b").test("axb"));
  });

  it("treats a plain owned path as one file and a trailing slash as a directory", () => {
    assert.isTrue(matchesOwnedPath("docs/x.md", "docs/x.md"));
    assert.isFalse(matchesOwnedPath("docs/x.md.bak", "docs/x.md"));
    assert.isTrue(matchesOwnedPath("kodo/a/b", "kodo/"));
  });
});
