import { describe, expect, it } from "@effect/vitest";

import { readKodoInlineBlocks } from "./inlineBlocks.logic";

const review = {
  version: 1,
  verdict: "concerns",
  summary: "One issue.",
  findings: [{ id: "a", severity: "medium", title: "Off by one", detail: "Uses `+ 1`." }],
};
const verdict = {
  version: 1,
  complete: false,
  summary: "Not done.",
  outstanding: [{ id: "o1", title: "No test", detail: "Add one." }],
  approach: "Add the test.",
};
const fence = (label: string, body: object) => `\`\`\`${label}\n${JSON.stringify(body)}\n\`\`\``;

describe("readKodoInlineBlocks", () => {
  it("leaves a reply without the labels untouched, and reads nothing", () => {
    const text = "Just prose with a ```ts\ncode\n``` block.";
    expect(readKodoInlineBlocks(text)).toEqual({ text, review: null, verdict: null });
  });

  it("hides a valid review block and returns its findings", () => {
    const read = readKodoInlineBlocks(`Looks mostly fine.\n\n${fence("kodo-review", review)}\n`);
    expect(read.review?.findings[0]?.title).toBe("Off by one");
    expect(read.text.trim()).toBe("Looks mostly fine.");
    expect(read.verdict).toBeNull();
  });

  it("hides a valid verdict block and returns it", () => {
    const read = readKodoInlineBlocks(`Judging.\n\n${fence("kodo-verdict", verdict)}`);
    expect(read.verdict?.complete).toBe(false);
    expect(read.verdict?.outstanding).toHaveLength(1);
    expect(read.text.trim()).toBe("Judging.");
  });

  it("keeps an invalid block as written", () => {
    const text = "x\n\n```kodo-review\n{not json}\n```";
    expect(readKodoInlineBlocks(text)).toEqual({ text, review: null, verdict: null });
  });

  it("is read once per text", () => {
    const text = `a\n${fence("kodo-review", review)}`;
    expect(readKodoInlineBlocks(text)).toBe(readKodoInlineBlocks(text));
  });
});
