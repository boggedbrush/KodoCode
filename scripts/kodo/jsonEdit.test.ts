import { assert, describe, it } from "@effect/vitest";

import { formatJsonPath, setJsonPath } from "./jsonEdit.ts";

const changed = (result: ReturnType<typeof setJsonPath>): string => {
  assert.strictEqual(result.kind, "changed");
  return result.kind === "changed" ? result.text : "";
};

describe("setJsonPath", () => {
  it("replaces only the addressed value", () => {
    const text = '{\n  // keep me\n  "a": { "b": [1, 2], "c": "x" },\n  "d": 1\n}\n';
    assert.strictEqual(
      changed(setJsonPath(text, ["a", "c"], "y")),
      '{\n  // keep me\n  "a": { "b": [1, 2], "c": "y" },\n  "d": 1\n}\n',
    );
    assert.strictEqual(
      changed(setJsonPath(text, ["a", "b", 1], 9)),
      '{\n  // keep me\n  "a": { "b": [1, 9], "c": "x" },\n  "d": 1\n}\n',
    );
  });

  it("is unchanged when the value already matches, even for objects", () => {
    assert.strictEqual(setJsonPath('{"a":{"b":1}}', ["a"], { b: 1 }).kind, "unchanged");
    assert.strictEqual(setJsonPath('{"a":"x"}', ["a"], "x").kind, "unchanged");
  });

  it("reports the first missing path prefix", () => {
    const result = setJsonPath('{"a":{}}', ["a", "b", "c"], 1);
    assert.deepStrictEqual(result, { kind: "missing", missingAt: ["a", "b"] });
  });

  it("inserts a missing key when create is set", () => {
    assert.strictEqual(
      changed(setJsonPath('{\n  "a": 1\n}\n', ["b"], "x", { create: true })),
      '{\n  "a": 1,\n  "b": "x"\n}\n',
    );
    assert.strictEqual(
      changed(setJsonPath('{"a": 1}', ["b"], 2, { create: true })),
      '{"a": 1, "b": 2}',
    );
    assert.strictEqual(
      changed(setJsonPath('{\n  "a": {}\n}\n', ["a", "k"], true, { create: true })),
      '{\n  "a": {\n    "k": true\n  }\n}\n',
    );
  });

  it("indents an inserted object like its sibling members", () => {
    const text = '{\n  "exports": {\n    "./a": {\n      "x": 1\n    }\n  }\n}\n';
    assert.strictEqual(
      changed(setJsonPath(text, ["exports", "./b"], { x: 2 }, { create: true })),
      '{\n  "exports": {\n    "./a": {\n      "x": 1\n    },\n    "./b": {\n      "x": 2\n    }\n  }\n}\n',
    );
  });

  it("formats paths with dotted keys unambiguously", () => {
    assert.strictEqual(formatJsonPath(["exports", "./a", 0, "b"]), 'exports["./a"][0].b');
  });

  it("reports unparseable documents", () => {
    assert.strictEqual(setJsonPath("{ nope", ["a"], 1).kind, "invalid");
    assert.strictEqual(setJsonPath("<<<<<<< HEAD", ["a"], 1).kind, "invalid");
  });

  it("handles escaped quotes in strings", () => {
    const text = '{"a": "x\\"y", "b": 1}';
    assert.strictEqual(changed(setJsonPath(text, ["b"], 2)), '{"a": "x\\"y", "b": 2}');
  });
});
