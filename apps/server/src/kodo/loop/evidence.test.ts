import { describe, expect, it } from "@effect/vitest";
import { parseKodoVerdict } from "@t3tools/shared/kodoLoopOutput";

import {
  LOOP_EVIDENCE_LIMITS,
  LOOP_VERDICT_FORMAT,
  buildLoopCodePrompt,
  buildLoopJudgePrompt,
  buildLoopPlanPrompt,
  buildLoopReviewPrompt,
  type LoopDiffEvidence,
} from "./evidence.ts";
import { incompleteVerdict, passReview } from "./testing.ts";

const base = { request: "Make the parser stricter.", round: 1, maxRounds: 3 };
const diff: LoopDiffEvidence = {
  kind: "diff",
  text: "--- a/x\n+++ b/x\n+new line",
  truncated: false,
};

describe("plan prompt", () => {
  it("round one carries the request and the task, and nothing about earlier rounds", () => {
    const prompt = buildLoopPlanPrompt(base);
    expect(prompt).toContain("round 1 of 3");
    expect(prompt).toContain("Make the parser stricter.");
    expect(prompt).toContain("Do not implement anything");
    expect(prompt).not.toContain("left undone");
  });

  it("a later round is seeded with the verdict's outstanding items and approach", () => {
    const prompt = buildLoopPlanPrompt({
      ...base,
      round: 2,
      previous: { verdict: incompleteVerdict, history: ["Added the strict mode flag"] },
    });
    expect(prompt).toContain("round 2 of 3");
    expect(prompt).toContain("No test (o1): Nothing covers the new branch.");
    expect(prompt).toContain("Add the test, then run the checks.");
    expect(prompt).toContain("- Added the strict mode flag");
    expect(prompt).toContain("Plan only what is still undone");
  });
});

describe("code prompt", () => {
  it("carries the plan, and the outstanding items and findings from a later round", () => {
    const first = buildLoopCodePrompt({ ...base, plan: "1. Edit parser." });
    expect(first).toContain("1. Edit parser.");
    expect(first).toContain("you may modify files");
    expect(first).not.toContain("Still outstanding");
    const later = buildLoopCodePrompt({
      ...base,
      round: 2,
      plan: "1. Add test.",
      outstanding: incompleteVerdict.outstanding,
      openFindings: [
        {
          id: "f1",
          severity: "high",
          title: "Off by one",
          file: "src/a.ts",
          line: 9,
          detail: "Skips the last item.",
          fix: "Use <=.",
        },
      ],
    });
    expect(later).toContain("Still outstanding");
    expect(later).toContain(
      "- high: Off by one [src/a.ts:9]: Skips the last item. Suggested fix: Use <=.",
    );
  });

  it("caps an oversized plan", () => {
    const prompt = buildLoopCodePrompt({
      ...base,
      plan: "p".repeat(LOOP_EVIDENCE_LIMITS.plan + 500),
    });
    expect(prompt).toContain("500 more characters left out");
  });
});

describe("review prompt", () => {
  const input = { ...base, plan: "The plan.", codeReport: "Changed x. Ran the tests." };

  it("carries the plan, the diff and the coder's report, and forbids commands that need approval", () => {
    const prompt = buildLoopReviewPrompt({ ...input, diff });
    expect(prompt).toContain("+new line");
    expect(prompt).toContain("Changed x. Ran the tests.");
    expect(prompt).toContain("`kodo-review` block");
    expect(prompt).toContain("need approval");
  });

  it("says so when there is no diff, as in a project without git history", () => {
    const prompt = buildLoopReviewPrompt({
      ...input,
      diff: { kind: "unavailable", reason: "the project is not a git repository" },
    });
    expect(prompt).toContain("No diff is available (the project is not a git repository)");
    expect(prompt).not.toContain("```diff");
  });

  it("points at the rest of a cut-short diff, and caps one that is too large", () => {
    const cut = buildLoopReviewPrompt({
      ...input,
      diff: { ...diff, truncated: true, baseRef: "abc123" },
    });
    expect(cut).toContain("Run `git diff abc123` to read all of it.");
    const huge = buildLoopReviewPrompt({
      ...input,
      diff: { kind: "diff", text: "+x\n".repeat(LOOP_EVIDENCE_LIMITS.diff), truncated: false },
    });
    expect(huge).toContain("The diff below is cut short.");
  });

  it("fences a diff that contains backticks without letting it close early", () => {
    const prompt = buildLoopReviewPrompt({
      ...input,
      diff: { kind: "diff", text: "+```ts\n+code\n+```", truncated: false },
    });
    expect(prompt).toContain("````diff\n+```ts\n+code\n+```\n````");
  });

  it("notes an empty diff and a missing report", () => {
    const prompt = buildLoopReviewPrompt({
      ...input,
      codeReport: "  ",
      diff: { kind: "diff", text: "", truncated: false },
    });
    expect(prompt).toContain("has not changed any files");
    expect(prompt).toContain("wrote no report");
  });
});

describe("judge prompt", () => {
  const input = { ...base, plan: "The plan.", diff };

  it("states the three questions and a format whose own example the parser accepts", () => {
    const prompt = buildLoopJudgePrompt({
      ...input,
      review: { kind: "parsed", result: passReview },
    });
    expect(prompt).toContain("1. Is the request complete?");
    expect(prompt).toContain("2. If not, what is outstanding?");
    expect(prompt).toContain("3. If not, what approach should the next round take?");
    expect(prompt).toContain("Do not run any commands");
    expect(parseKodoVerdict(LOOP_VERDICT_FORMAT).ok).toBe(true);
    expect(prompt).toContain(LOOP_VERDICT_FORMAT);
  });

  it("gives a parsed review as findings and an unreadable one as capped text", () => {
    const parsed = buildLoopJudgePrompt({
      ...input,
      review: {
        kind: "parsed",
        result: {
          version: 1,
          verdict: "concerns",
          summary: "One issue.",
          findings: [
            { id: "f1", severity: "medium", title: "Missing check", detail: "No null check." },
          ],
        },
      },
    });
    expect(parsed).toContain("Verdict: concerns. One issue.");
    expect(parsed).toContain("- medium: Missing check: No null check.");
    const raw = buildLoopJudgePrompt({
      ...input,
      review: { kind: "raw", text: "r".repeat(LOOP_EVIDENCE_LIMITS.rawReview + 10) },
    });
    expect(raw).toContain("could not be read as structured findings");
    expect(raw).toContain("10 more characters left out");
  });

  it("an empty parsed review says there were no findings", () => {
    const prompt = buildLoopJudgePrompt({
      ...input,
      review: {
        kind: "parsed",
        result: { version: 1, verdict: "pass", summary: "Clean.", findings: [] },
      },
    });
    expect(prompt).toContain("No findings.");
  });
});
