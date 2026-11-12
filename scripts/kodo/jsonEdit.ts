// Surgical edits of a JSON or JSONC document by key path. Only the replaced
// value's text changes, so formatting, key order and comments elsewhere stay
// exactly as upstream wrote them (a stringify round trip would reformat files
// like package.json and show up as noise in every sync diff).

export type JsonPathSegment = string | number;

type JsonNode =
  | {
      readonly kind: "object";
      readonly start: number;
      readonly end: number;
      readonly members: ReadonlyArray<{
        readonly key: string;
        readonly keyStart: number;
        readonly value: JsonNode;
      }>;
    }
  | {
      readonly kind: "array";
      readonly start: number;
      readonly end: number;
      readonly items: ReadonlyArray<JsonNode>;
    }
  | { readonly kind: "scalar"; readonly start: number; readonly end: number };

class JsonSyntaxError {
  readonly message: string;
  constructor(message: string) {
    this.message = message;
  }
}

const parseDocument = (text: string): JsonNode => {
  let i = 0;
  const fail = (message: string): never => {
    throw new JsonSyntaxError(`${message} at offset ${i}`);
  };
  const skip = () => {
    for (;;) {
      const char = text[i];
      if (char === " " || char === "\t" || char === "\n" || char === "\r" || char === "﻿") i++;
      else if (char === "/" && text[i + 1] === "/") {
        while (i < text.length && text[i] !== "\n") i++;
      } else if (char === "/" && text[i + 1] === "*") {
        const close = text.indexOf("*/", i + 2);
        if (close < 0) fail("Unterminated comment");
        i = close + 2;
      } else return;
    }
  };
  const string = (): string => {
    const start = i;
    i++;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    if (i >= text.length) fail("Unterminated string");
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (): JsonNode => {
    skip();
    const start = i;
    const char = text[i];
    if (char === "{") {
      i++;
      const members: Array<{ key: string; keyStart: number; value: JsonNode }> = [];
      for (;;) {
        skip();
        if (text[i] === "}") break;
        if (text[i] !== '"') fail("Expected a string key");
        const keyStart = i;
        const key = string();
        skip();
        if (text[i] !== ":") fail("Expected ':'");
        i++;
        members.push({ key, keyStart, value: value() });
        skip();
        if (text[i] === ",") i++;
        else if (text[i] !== "}") fail("Expected ',' or '}'");
      }
      i++;
      return { kind: "object", start, end: i, members };
    }
    if (char === "[") {
      i++;
      const items: JsonNode[] = [];
      for (;;) {
        skip();
        if (text[i] === "]") break;
        items.push(value());
        skip();
        if (text[i] === ",") i++;
        else if (text[i] !== "]") fail("Expected ',' or ']'");
      }
      i++;
      return { kind: "array", start, end: i, items };
    }
    if (char === '"') {
      string();
      return { kind: "scalar", start, end: i };
    }
    const literal = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
    if (!literal) return fail("Unexpected token");
    i += literal[0].length;
    return { kind: "scalar", start, end: i };
  };
  const root = value();
  skip();
  if (i < text.length) fail("Unexpected content after the document");
  return root;
};

const lineIndent = (text: string, offset: number): string => {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart, offset))?.[0] ?? "";
};

const render = (value: unknown, baseIndent: string): string =>
  JSON.stringify(value, null, 2).replaceAll("\n", `\n${baseIndent}`);

const sameJson = (text: string, value: unknown): boolean => {
  try {
    return JSON.stringify(JSON.parse(text)) === JSON.stringify(value);
  } catch {
    return false;
  }
};

export type JsonSetResult =
  | { readonly kind: "changed"; readonly text: string }
  | { readonly kind: "unchanged" }
  // `missingAt` is the path prefix that does not exist in the document.
  | { readonly kind: "missing"; readonly missingAt: ReadonlyArray<JsonPathSegment> }
  | { readonly kind: "invalid"; readonly message: string };

export const formatJsonPath = (path: ReadonlyArray<JsonPathSegment>): string =>
  path
    .map((segment, index) =>
      typeof segment === "number"
        ? `[${segment}]`
        : /[.[\]]/.test(segment)
          ? `[${JSON.stringify(segment)}]`
          : `${index === 0 ? "" : "."}${segment}`,
    )
    .join("");

export const setJsonPath = (
  text: string,
  path: ReadonlyArray<JsonPathSegment>,
  value: unknown,
  options: { readonly create?: boolean } = {},
): JsonSetResult => {
  let root: JsonNode;
  try {
    root = parseDocument(text);
  } catch (error) {
    if (error instanceof JsonSyntaxError) return { kind: "invalid", message: error.message };
    throw error;
  }

  let node = root;
  for (const [index, segment] of path.entries()) {
    const isLast = index === path.length - 1;
    const child =
      node.kind === "object"
        ? node.members.find((member) => member.key === String(segment))?.value
        : node.kind === "array" && typeof segment === "number"
          ? node.items[segment]
          : undefined;
    if (child) {
      node = child;
      continue;
    }
    if (isLast && options.create && node.kind === "object" && typeof segment === "string") {
      const last = node.members.at(-1);
      const baseIndent = lineIndent(text, node.start);
      if (!last) {
        const member = `${JSON.stringify(segment)}: ${render(value, `${baseIndent}  `)}`;
        return {
          kind: "changed",
          text: `${text.slice(0, node.start)}{\n${baseIndent}  ${member}\n${baseIndent}}${text.slice(node.end)}`,
        };
      }
      const multiline = text.slice(node.start, last.keyStart).includes("\n");
      const memberIndent = multiline ? lineIndent(text, last.keyStart) : "";
      const member = `${JSON.stringify(segment)}: ${render(value, memberIndent)}`;
      const separator = multiline ? `,\n${memberIndent}` : ", ";
      return {
        kind: "changed",
        text: `${text.slice(0, last.value.end)}${separator}${member}${text.slice(last.value.end)}`,
      };
    }
    return { kind: "missing", missingAt: path.slice(0, index + 1) };
  }

  const current = text.slice(node.start, node.end);
  if (sameJson(current, value)) return { kind: "unchanged" };
  return {
    kind: "changed",
    text: `${text.slice(0, node.start)}${render(value, lineIndent(text, node.start))}${text.slice(node.end)}`,
  };
};
