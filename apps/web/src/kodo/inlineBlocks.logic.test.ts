import { describe, expect, it } from "@effect/vitest";

import {
  NO_KODO_BLOCK_STAGE,
  kodoInlineBlockStage,
  readKodoInlineBlocks,
} from "./inlineBlocks.logic";

const REVIEW = { review: true, verdict: false } as const;
const JUDGE = { review: false, verdict: true } as const;

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
    expect(readKodoInlineBlocks(text, REVIEW)).toEqual({ text, review: null, verdict: null });
  });

  it("hides a valid trailing review block in a Review run and returns its findings", () => {
    const read = readKodoInlineBlocks(
      `Looks mostly fine.\n\n${fence("kodo-review", review)}\n`,
      REVIEW,
    );
    expect(read.review?.findings[0]?.title).toBe("Off by one");
    expect(read.text.trim()).toBe("Looks mostly fine.");
    expect(read.verdict).toBeNull();
  });

  it("hides a valid verdict block in a judge stage and returns it", () => {
    const read = readKodoInlineBlocks(`Judging.\n\n${fence("kodo-verdict", verdict)}`, JUDGE);
    expect(read.verdict?.complete).toBe(false);
    expect(read.verdict?.outstanding).toHaveLength(1);
    expect(read.text.trim()).toBe("Judging.");
  });

  it("an example block in a reply outside its stage stays visible as written", () => {
    const reviewText = `Here is the format:\n\n${fence("kodo-review", review)}`;
    const verdictText = `Here is the format:\n\n${fence("kodo-verdict", verdict)}`;
    // An Ask, Plan or Code reply is asked for neither; a Review reply is not asked for a verdict.
    expect(readKodoInlineBlocks(reviewText, NO_KODO_BLOCK_STAGE).text).toBe(reviewText);
    expect(readKodoInlineBlocks(verdictText, REVIEW).text).toBe(verdictText);
    expect(readKodoInlineBlocks(reviewText, JUDGE).text).toBe(reviewText);
    expect(readKodoInlineBlocks(verdictText, NO_KODO_BLOCK_STAGE).verdict).toBeNull();
  });

  it("keeps an invalid block, a misplaced block and a second block as written", () => {
    const invalid = "x\n\n```kodo-review\n{not json}\n```";
    const notLast = `${fence("kodo-review", review)}\n\nAnd then some prose.`;
    const twice = `${fence("kodo-review", review)}\n${fence("kodo-review", review)}`;
    for (const text of [invalid, notLast, twice]) {
      expect(readKodoInlineBlocks(text, REVIEW)).toEqual({ text, review: null, verdict: null });
    }
  });

  it("does not read a reply that is still streaming", () => {
    const text = `a\n${fence("kodo-review", review)}`;
    expect(readKodoInlineBlocks(text, REVIEW, true)).toEqual({ text, review: null, verdict: null });
  });

  it("is read once per text and stage", () => {
    const text = `a\n${fence("kodo-review", review)}`;
    expect(readKodoInlineBlocks(text, REVIEW)).toBe(readKodoInlineBlocks(text, REVIEW));
  });
});

describe("kodoInlineBlockStage", () => {
  const runs = [
    { id: "r-ask", interactionMode: "ask", userMessageId: "m1" },
    { id: "r-review", interactionMode: "review", userMessageId: "m2" },
    { id: "r-judge", interactionMode: "review", userMessageId: "kodo-loop-L1-r1-judge" },
    {
      id: "r-judge-restarted",
      interactionMode: "review",
      userMessageId: "restart-note",
      restartContinuationOfRunId: "r-judge",
    },
    { id: "r-code-stage", interactionMode: "code", userMessageId: "kodo-loop-L1-r1-code" },
  ];

  it.each([
    ["an Ask reply", "r-ask", { review: false, verdict: false }],
    ["a Review reply", "r-review", { review: true, verdict: false }],
    ["a loop's judge stage", "r-judge", { review: true, verdict: true }],
    ["a judge stage a restart continued", "r-judge-restarted", { review: true, verdict: true }],
    ["a loop's code stage", "r-code-stage", { review: false, verdict: false }],
    ["a run the timeline does not know", "r-none", { review: false, verdict: false }],
  ])("%s", (_name, runId, expected) => {
    expect(kodoInlineBlockStage(runs, runId)).toEqual(expected);
  });
});
