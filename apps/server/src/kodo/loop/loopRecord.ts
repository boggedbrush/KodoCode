// What a stage record keeps. The thread's payload carries the loop on every thread event, so a
// record holds only headlines; the plan, the review's findings and the verdict's detail are read
// again from the stage run's own reply when a later stage needs them (see LoopStepper).
import {
  KODO_LOOP_CONCLUSION_MAX_CHARS,
  KODO_LOOP_RECORD_OUTSTANDING_MAX,
  KODO_LOOP_RECORD_TITLE_MAX_CHARS,
  type KodoLoopRecordReview,
  type KodoLoopRecordVerdict,
  type KodoLoopVerdict,
  type KodoReviewResult,
} from "@t3tools/contracts";

/** `text` cut to `max` characters, with an ellipsis when it was cut. */
export function clipLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** The first line of a reply that says something: not blank, not a heading mark, not a fence. */
export function firstSayingLine(text: string | null | undefined): string | undefined {
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/^[#>*\-\s]+/, "").trim();
    if (line.length === 0 || line.startsWith("```") || line.startsWith("~~~")) continue;
    return clipLine(line, KODO_LOOP_CONCLUSION_MAX_CHARS);
  }
  return undefined;
}

export const conclusionOf = (summary: string | null | undefined): string | undefined => {
  const line = clipLine(summary ?? "", KODO_LOOP_CONCLUSION_MAX_CHARS);
  return line.length === 0 ? undefined : line;
};

export function compactVerdict(verdict: KodoLoopVerdict): KodoLoopRecordVerdict {
  return {
    complete: verdict.complete,
    outstandingCount: verdict.outstanding.length,
    outstanding: verdict.outstanding.slice(0, KODO_LOOP_RECORD_OUTSTANDING_MAX).map((item) => ({
      title: clipLine(item.title, KODO_LOOP_RECORD_TITLE_MAX_CHARS) || item.id.slice(0, 64),
    })),
  };
}

export function compactReview(
  review: KodoReviewResult | undefined,
  parsed: boolean,
): KodoLoopRecordReview {
  if (review === undefined) return { parsed, findings: 0, high: 0 };
  return {
    parsed,
    verdict: review.verdict,
    findings: review.findings.length,
    high: review.findings.filter((finding) => finding.severity === "high").length,
  };
}
