import type { ReviewFinding, ReviewReport, ReviewSeverity } from "./types";
export type { ReviewFinding, ReviewReport, ReviewSeverity } from "./types";

export type ReviewTargetKind = "uncommitted" | "base-branch" | "upstream-base" | "specific-diff";

export type ReviewFocus =
  | "correctness"
  | "regressions"
  | "security"
  | "performance"
  | "architecture";

export interface ReviewRequestDraft {
  targetKind: ReviewTargetKind;
  targetRef: string;
  focus: ReviewFocus[];
  diffText?: string;
}

const REVIEW_SEVERITIES = new Set<ReviewSeverity>(["critical", "high", "medium", "low", "info"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function uniqueStrings(values: ReadonlyArray<string>): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function parseFinding(value: unknown): ReviewFinding | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const severityCandidate = asTrimmedString(record.severity)?.toLowerCase();
  const normalizedSeverity =
    severityCandidate && REVIEW_SEVERITIES.has(severityCandidate as ReviewSeverity)
      ? (severityCandidate as ReviewSeverity)
      : null;
  const title = asTrimmedString(record.title);
  const rationale = asTrimmedString(record.rationale);
  const suggestedFix = asTrimmedString(record.suggestedFix ?? record.suggested_fix);
  const affectedFiles = Array.isArray(record.affectedFiles)
    ? uniqueStrings(
        record.affectedFiles.flatMap((entry) => (typeof entry === "string" ? [entry] : [])),
      )
    : [];
  const canImplement = typeof record.canImplement === "boolean" ? record.canImplement : false;

  if (!normalizedSeverity || !title || !rationale || !suggestedFix) {
    return null;
  }

  return {
    severity: normalizedSeverity,
    title,
    affectedFiles,
    rationale,
    suggestedFix,
    canImplement,
  };
}

export function parseReviewReport(text: string): ReviewReport | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const fencedJson = /```json\s*([\s\S]*?)```/i.exec(trimmed)?.[1]?.trim();
  const candidate = fencedJson ?? trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }

  const record = asRecord(parsed);
  if (!record) {
    return null;
  }

  const summary = asTrimmedString(record.summary);
  const verdict = asTrimmedString(record.verdict);
  const findings = Array.isArray(record.findings)
    ? record.findings.flatMap((entry) => {
        const finding = parseFinding(entry);
        return finding ? [finding] : [];
      })
    : [];
  const openQuestions = Array.isArray(record.openQuestions)
    ? uniqueStrings(
        record.openQuestions.flatMap((entry) => (typeof entry === "string" ? [entry] : [])),
      )
    : [];

  if (!summary || !verdict) {
    return null;
  }

  return {
    summary,
    findings,
    openQuestions,
    verdict,
  };
}

function formatReviewFocusList(focus: ReadonlyArray<ReviewFocus>): string {
  return focus.length > 0 ? focus.join(", ") : "none";
}

function formatReviewTargetDescription(input: ReviewRequestDraft): string {
  switch (input.targetKind) {
    case "uncommitted":
      return "Current uncommitted work";
    case "base-branch":
      return `Changes against base branch: ${input.targetRef}`;
    case "upstream-base":
      return `Changes against upstream base: ${input.targetRef}`;
    case "specific-diff":
      return "Specific diff or patch";
  }
}

export function buildReviewRequestPrompt(input: ReviewRequestDraft): string {
  const sections = [
    "You are in Review mode. You must not modify files.",
    "Review the requested changes as a senior code reviewer.",
    "Prioritize correctness bugs, regressions, edge cases, security or privacy risks, data-loss risks, performance issues, and intent mismatches.",
    "Return a JSON object with keys: summary, findings, openQuestions, verdict.",
    "Rules:",
    "- Be concise and high-signal.",
    "- Each finding must include severity, title, affectedFiles, rationale, suggestedFix, and canImplement.",
    "- Findings must be grounded in the supplied diff or the explicitly requested target.",
    "- If there is not enough context, ask a clarifying question instead of speculating.",
    "",
    `Review target: ${formatReviewTargetDescription(input)}`,
    `Target reference: ${input.targetRef.length > 0 ? input.targetRef : "(none)"}`,
    `Review focus: ${formatReviewFocusList(input.focus)}`,
  ];

  if (input.diffText?.trim()) {
    sections.push("", "Specific diff or patch:", input.diffText.trim());
  }

  return sections.join("\n");
}

export function buildReviewImplementationPrompt(input: {
  findingTitles: ReadonlyArray<string>;
  targetSummary: string;
}): string {
  const titles = uniqueStrings(input.findingTitles);
  const findingSummary =
    titles.length > 0
      ? titles.map((title) => `- ${title}`).join("\n")
      : "- Approved review findings";

  return [
    "PLEASE IMPLEMENT THE APPROVED REVIEW FINDINGS:",
    input.targetSummary,
    "",
    "Approved findings:",
    findingSummary,
    "",
    "Rules:",
    "- Fix only the approved review findings.",
    "- Keep the change minimal and localized.",
    "- Avoid unrelated cleanup or refactors.",
    "- Preserve behavior outside the approved issues.",
  ].join("\n");
}

export function buildReviewExportMarkdown(report: ReviewReport): string {
  const lines: string[] = ["# Review report", ""];
  lines.push("## Summary", report.summary, "");
  lines.push("## Verdict", report.verdict, "");
  if (report.findings.length > 0) {
    lines.push("## Findings");
    for (const finding of report.findings) {
      lines.push(
        `- **${finding.severity.toUpperCase()}** ${finding.title} (${finding.affectedFiles.join(", ") || "no files listed"})`,
        `  - Rationale: ${finding.rationale}`,
        `  - Suggested fix: ${finding.suggestedFix}`,
        `  - Implementable: ${finding.canImplement ? "yes" : "no"}`,
      );
    }
    lines.push("");
  }
  if (report.openQuestions.length > 0) {
    lines.push("## Open questions");
    for (const question of report.openQuestions) {
      lines.push(`- ${question}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function downloadReviewAsTextFile(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
