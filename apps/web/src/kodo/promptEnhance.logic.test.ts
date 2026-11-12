import { describe, expect, it } from "vite-plus/test";

import {
  describePromptEnhanceFailure,
  droppedReferences,
  IDLE_PROMPT_ENHANCE_STATE,
  promptEnhanceBlock,
  promptEnhanceReducer,
  resolvePromptEnhanceOutcome,
  undoableOriginal,
  type PromptEnhanceState,
} from "./promptEnhance.logic";

const terminal = "[log](t3-context://v1/terminal/terminal_1)";
const image = "![shot.png](t3-context://v1/image/image_1)";

describe("promptEnhanceReducer", () => {
  it("walks idle, enhancing, enhanced and back through one undo", () => {
    let state: PromptEnhanceState = IDLE_PROMPT_ENHANCE_STATE;
    state = promptEnhanceReducer(state, { type: "start", original: "fix it" });
    expect(state).toEqual({ phase: "enhancing", original: "fix it" });
    state = promptEnhanceReducer(state, {
      type: "succeed",
      original: "fix it",
      enhanced: "Fix X.",
    });
    expect(state).toEqual({ phase: "enhanced", original: "fix it", enhanced: "Fix X." });
    expect(promptEnhanceReducer(state, { type: "undo" })).toEqual(IDLE_PROMPT_ENHANCE_STATE);
  });

  it("ignores a result for a draft that is no longer the one being enhanced", () => {
    const enhancing = promptEnhanceReducer(IDLE_PROMPT_ENHANCE_STATE, {
      type: "start",
      original: "a",
    });
    expect(promptEnhanceReducer(enhancing, { type: "succeed", original: "b", enhanced: "c" })).toBe(
      enhancing,
    );
    expect(
      promptEnhanceReducer(IDLE_PROMPT_ENHANCE_STATE, {
        type: "succeed",
        original: "a",
        enhanced: "c",
      }),
    ).toBe(IDLE_PROMPT_ENHANCE_STATE);
  });

  it("returns to idle when a request ends without applying", () => {
    const enhancing = promptEnhanceReducer(IDLE_PROMPT_ENHANCE_STATE, {
      type: "start",
      original: "a",
    });
    expect(promptEnhanceReducer(enhancing, { type: "end" })).toEqual(IDLE_PROMPT_ENHANCE_STATE);
  });
});

describe("undoableOriginal", () => {
  const enhanced: PromptEnhanceState = {
    phase: "enhanced",
    original: "fix it",
    enhanced: "Fix X.",
  };

  it("offers undo only while the draft is still the rewrite", () => {
    expect(undoableOriginal(enhanced, "Fix X.")).toBe("fix it");
    expect(undoableOriginal(enhanced, "Fix X. Also Y.")).toBeNull();
    expect(undoableOriginal(IDLE_PROMPT_ENHANCE_STATE, "Fix X.")).toBeNull();
  });
});

describe("promptEnhanceBlock", () => {
  it("blocks blank and over-long drafts", () => {
    expect(promptEnhanceBlock(" \n")).toEqual({ kind: "empty" });
    expect(promptEnhanceBlock("x".repeat(12_001))).toEqual({ kind: "too-long", limit: 12_000 });
    expect(promptEnhanceBlock("x".repeat(12_000))).toBeNull();
  });
});

describe("resolvePromptEnhanceOutcome", () => {
  const original = `look at ${terminal} and ${image} in @README.md using $review please`;

  it("applies a rewrite that keeps every reference", () => {
    const text = `Investigate ${terminal}, ${image}: review @README.md with $review now.`;
    expect(resolvePromptEnhanceOutcome(original, `\n${text}\n`)).toEqual({ kind: "apply", text });
  });

  it("refuses a rewrite that lost a context link, image, mention or skill", () => {
    const lost = resolvePromptEnhanceOutcome(original, `Review ${image} @README.md $review now.`);
    expect(lost).toEqual({ kind: "refused", dropped: [terminal] });
    expect(droppedReferences(original, "Review.")).toEqual([
      terminal,
      image,
      "@README.md",
      "$review",
    ]);
  });

  it("treats a mention or skill the model glued punctuation to as dropped", () => {
    // The composer only recognises @path and $skill before whitespace, so the chip would be lost.
    expect(droppedReferences("see @README.md now", "See @README.md.")).toEqual(["@README.md"]);
  });

  it("counts a reference that appeared twice twice", () => {
    expect(droppedReferences(`${terminal} ${terminal}`, `only ${terminal}`)).toEqual([terminal]);
  });

  it("leaves the draft alone for an empty or identical answer", () => {
    expect(resolvePromptEnhanceOutcome(original, "  \n")).toEqual({ kind: "unchanged" });
    expect(resolvePromptEnhanceOutcome(original, `${original}\n`)).toEqual({ kind: "unchanged" });
  });
});

describe("describePromptEnhanceFailure", () => {
  it("shows the model's own reason and explains an environment without the endpoint", () => {
    expect(
      describePromptEnhanceFailure({
        _tag: "KodoPromptEnhanceError",
        message: "Codex is not signed in.",
      }),
    ).toBe("Codex is not signed in.");
    expect(
      describePromptEnhanceFailure({
        _tag: "RemoteEnvironmentAuthUndeclaredStatusError",
        status: 404,
      }),
    ).toContain("too old");
    expect(describePromptEnhanceFailure(new Error("socket closed"))).toBe("socket closed");
    expect(describePromptEnhanceFailure("nope")).toBe("The prompt could not be enhanced.");
  });
});
