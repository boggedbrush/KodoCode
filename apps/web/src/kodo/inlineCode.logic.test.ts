import { describe, expect, it } from "@effect/vitest";

import { splitInlineCode } from "./inlineCode.logic";

const text = (value: string) => ({ kind: "text", text: value }) as const;
const code = (value: string) => ({ kind: "code", text: value }) as const;

describe("splitInlineCode", () => {
  it.each([
    ["plain text is one segment", "No code here.", [text("No code here.")]],
    ["empty text has none", "", []],
    [
      "a span in the middle",
      "The trailing `+ 1` pushes past it.",
      [text("The trailing "), code("+ 1"), text(" pushes past it.")],
    ],
    [
      "several spans",
      "When `min` is larger than `max`, swap.",
      [text("When "), code("min"), text(" is larger than "), code("max"), text(", swap.")],
    ],
    ["only a span", "`x`", [code("x")]],
    ["an unbalanced backtick stays literal", "It breaks `here", [text("It breaks `here")]],
    [
      "an unbalanced one after a balanced pair stays literal",
      "`a` then ` stray",
      [code("a"), text(" then ` stray")],
    ],
    ["an empty pair stays literal", "a `` b", [text("a `` b")]],
    ["a span never crosses a line", "first `one\ntwo` second", [text("first `one\ntwo` second")]],
    ["backticks inside a span's text are not nested", "`a``b`", [code("a"), code("b")]],
  ] as const)("%s", (_name, input, expected) => {
    expect(splitInlineCode(input).map(({ kind, text }) => ({ kind, text }))).toEqual(expected);
  });
});

describe("splitInlineCode offsets", () => {
  it("each segment starts where it does in the text, so rows can be keyed by it", () => {
    expect(splitInlineCode("a `b` c `d`").map((segment) => segment.start)).toEqual([0, 2, 5, 8]);
  });
});
