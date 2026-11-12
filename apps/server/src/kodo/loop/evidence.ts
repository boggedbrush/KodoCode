// What each loop stage is told. Every stage runs in a fresh provider conversation, so its message
// is everything it knows: the request, the plan, the diff and the findings it needs, capped to a
// size, and the format it must answer in. Pure text building; the caller reads the thread and passes
// the pieces in.
import {
  KODO_REVIEW_MAX_FINDINGS,
  KODO_VERDICT_MAX_OUTSTANDING,
  type KodoLoopOutstandingItem,
  type KodoLoopVerdict,
  type KodoReviewFinding,
  type KodoReviewResult,
} from "@t3tools/contracts";

export const LOOP_EVIDENCE_LIMITS = {
  plan: 20_000,
  codeReport: 6_000,
  diff: 60_000,
  rawReview: 8_000,
} as const;

/** The loop's changes as the stages see them; a project without git history has none. */
export type LoopDiffEvidence =
  | {
      readonly kind: "diff";
      readonly text: string;
      /** The source already cut the diff short. */
      readonly truncated: boolean;
      /** What to pass to `git diff` to read the rest, when the loop recorded a starting point. */
      readonly baseRef?: string | undefined;
    }
  | { readonly kind: "unavailable"; readonly reason: string };

const READ_ONLY_RULE =
  "Do not run commands that change anything or that need approval; read files and use read-only git commands only.";

function capText(text: string, max: number): { readonly text: string; readonly cut: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= max) return { text: trimmed, cut: false };
  return {
    text: `${trimmed.slice(0, max)}\n[... ${trimmed.length - max} more characters left out]`,
    cut: true,
  };
}

/** A fenced block that the content cannot close early, whatever backticks it holds. */
function fenced(label: string, content: string): string {
  const longestRun = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${label}\n${content}\n${fence}`;
}

const header = (stage: string, round: number, maxRounds: number) =>
  `You are the ${stage} stage of an automated loop, round ${round} of ${maxRounds}. Other stages run in separate conversations, so everything you need is in this message.`;

const requestSection = (request: string) => `## Request\n\n${request.trim()}`;

const planSection = (plan: string) => {
  const capped = capText(plan, LOOP_EVIDENCE_LIMITS.plan);
  return `## Plan\n\n${capped.text}`;
};

function diffSection(diff: LoopDiffEvidence): string {
  if (diff.kind === "unavailable") {
    return `## Changes\n\nNo diff is available (${diff.reason}). Inspect the workspace directly with read-only commands.`;
  }
  const capped = capText(diff.text, LOOP_EVIDENCE_LIMITS.diff);
  const note =
    capped.cut || diff.truncated
      ? `\nThe diff below is cut short.${diff.baseRef === undefined ? "" : ` Run \`git diff ${diff.baseRef}\` to read all of it.`}\n`
      : "";
  return capped.text.length === 0
    ? "## Changes\n\nThe loop has not changed any files."
    : `## Changes\n${note}\n${fenced("diff", capped.text)}`;
}

const outstandingList = (items: ReadonlyArray<KodoLoopOutstandingItem>) =>
  items.map((item) => `- ${item.title} (${item.id}): ${item.detail}`).join("\n");

const findingsList = (findings: ReadonlyArray<KodoReviewFinding>) =>
  findings
    .map((finding) => {
      const where =
        finding.file === undefined
          ? ""
          : ` [${finding.file}${finding.line === undefined ? "" : `:${finding.line}`}]`;
      return `- ${finding.severity}: ${finding.title}${where}: ${finding.detail}${finding.fix === undefined ? "" : ` Suggested fix: ${finding.fix}`}`;
    })
    .join("\n");

export interface LoopPlanPromptInput {
  readonly request: string;
  readonly round: number;
  readonly maxRounds: number;
  /** From round two: what the last judge said was left, and brief notes on what has been done. */
  readonly previous?: {
    readonly verdict: KodoLoopVerdict;
    readonly history: ReadonlyArray<string>;
  };
}

export function buildLoopPlanPrompt(input: LoopPlanPromptInput): string {
  const sections = [
    header("planning", input.round, input.maxRounds),
    requestSection(input.request),
  ];
  if (input.previous !== undefined) {
    const { verdict, history } = input.previous;
    sections.push(
      [
        "## What the last round left undone",
        verdict.summary,
        outstandingList(verdict.outstanding),
        `The judge's advice: ${verdict.approach}`,
        ...(history.length === 0
          ? []
          : ["Already done in earlier rounds:", ...history.map((line) => `- ${line}`)]),
      ].join("\n\n"),
    );
  }
  sections.push(
    [
      "## Your task",
      "Investigate the code and write an implementation plan: the goal, the files and symbols involved, the ordered steps, and the risks. A coding stage will carry out exactly what you write and a reviewer will check the result against it, so be specific. Do not implement anything.",
      input.previous === undefined
        ? "Plan the whole request."
        : "Plan only what is still undone; do not redo finished work.",
      READ_ONLY_RULE,
    ].join("\n\n"),
  );
  return sections.join("\n\n");
}

export interface LoopCodePromptInput {
  readonly request: string;
  readonly round: number;
  readonly maxRounds: number;
  readonly plan: string;
  /** From round two: what the judge said was left, and the review's findings still open. */
  readonly outstanding?: ReadonlyArray<KodoLoopOutstandingItem>;
  readonly openFindings?: ReadonlyArray<KodoReviewFinding>;
}

export function buildLoopCodePrompt(input: LoopCodePromptInput): string {
  const sections = [
    header("coding", input.round, input.maxRounds),
    requestSection(input.request),
    planSection(input.plan),
  ];
  if ((input.outstanding?.length ?? 0) > 0) {
    sections.push(`## Still outstanding\n\n${outstandingList(input.outstanding ?? [])}`);
  }
  if ((input.openFindings?.length ?? 0) > 0) {
    sections.push(`## Review findings to address\n\n${findingsList(input.openFindings ?? [])}`);
  }
  sections.push(
    [
      "## Your task",
      "Implement the plan now; you may modify files. Keep to what the plan and the request ask for.",
      "When you are done, end with a short report: what you changed, which checks you ran and what they showed, and anything you could not finish. Do not say a check passed unless you ran it.",
    ].join("\n\n"),
  );
  return sections.join("\n\n");
}

export interface LoopReviewPromptInput {
  readonly request: string;
  readonly round: number;
  readonly maxRounds: number;
  readonly plan: string;
  readonly diff: LoopDiffEvidence;
  /** The coding stage's final message. */
  readonly codeReport: string;
}

export function buildLoopReviewPrompt(input: LoopReviewPromptInput): string {
  const report = capText(input.codeReport, LOOP_EVIDENCE_LIMITS.codeReport);
  return [
    header("review", input.round, input.maxRounds),
    requestSection(input.request),
    planSection(input.plan),
    diffSection(input.diff),
    `## The coder's report\n\n${report.text.length === 0 ? "(The coding stage wrote no report.)" : report.text}`,
    [
      "## Your task",
      "Review the changes against the request and the plan. Report what is wrong, not what is fine. End with the `kodo-review` block described in your instructions.",
      READ_ONLY_RULE,
    ].join("\n\n"),
  ].join("\n\n");
}

/** The review the judge reads: the parsed result, or the review's text when it could not be parsed. */
export type LoopJudgeReview =
  | { readonly kind: "parsed"; readonly result: KodoReviewResult }
  | { readonly kind: "raw"; readonly text: string };

export interface LoopJudgePromptInput {
  readonly request: string;
  readonly round: number;
  readonly maxRounds: number;
  readonly plan: string;
  readonly diff: LoopDiffEvidence;
  readonly review: LoopJudgeReview;
}

/** The format the judge answers in. Kept here so its example can be checked against the parser. */
export const LOOP_VERDICT_FORMAT = [
  "Answer with a short explanation, then end your reply with exactly one fenced block labelled `kodo-verdict`, holding JSON, and nothing after it:",
  "",
  "```kodo-verdict",
  '{"version":1,"complete":false,"summary":"One or two sentences.","outstanding":[{"id":"o1","title":"Short name","detail":"What is still missing or wrong."}],"approach":"How the next round should proceed."}',
  "```",
  "",
  `- \`complete\` is true only when the request is fully met. Then \`outstanding\` is \`[]\`.`,
  `- When \`complete\` is false, list at least one item in \`outstanding\` (at most ${KODO_VERDICT_MAX_OUTSTANDING}) and say in \`approach\` how the next round should go about it.`,
  "- Keep `summary` under 600 characters, each `detail` under 2000 and `approach` under 2000.",
  "- The block must be valid JSON: double quotes, no comments, no trailing commas.",
].join("\n");

export function buildLoopJudgePrompt(input: LoopJudgePromptInput): string {
  const review =
    input.review.kind === "parsed"
      ? [
          `Verdict: ${input.review.result.verdict}. ${input.review.result.summary}`,
          input.review.result.findings.length === 0
            ? "No findings."
            : findingsList(input.review.result.findings.slice(0, KODO_REVIEW_MAX_FINDINGS)),
        ].join("\n\n")
      : `The review could not be read as structured findings. Its text follows.\n\n${capText(input.review.text, LOOP_EVIDENCE_LIMITS.rawReview).text}`;
  return [
    header("judge", input.round, input.maxRounds),
    requestSection(input.request),
    planSection(input.plan),
    diffSection(input.diff),
    `## The review\n\n${review}`,
    [
      "## Your task",
      "Decide, from this evidence alone:",
      "1. Is the request complete?",
      "2. If not, what is outstanding?",
      "3. If not, what approach should the next round take?",
      "Do not run any commands. You may read files in the workspace to check a claim.",
      "This answer format replaces the review format in your instructions.",
      LOOP_VERDICT_FORMAT,
    ].join("\n\n"),
  ].join("\n\n");
}
