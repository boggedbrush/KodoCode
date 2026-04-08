import { memo, useMemo, useState } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "~/lib/utils";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import {
  buildReviewExportMarkdown,
  downloadReviewAsTextFile,
  type ReviewFinding,
  type ReviewReport,
} from "../../review";

function formatFindingCopyText(finding: ReviewFinding): string {
  return [
    `Severity: ${finding.severity}`,
    `Title: ${finding.title}`,
    `Affected files: ${finding.affectedFiles.join(", ") || "none"}`,
    `Rationale: ${finding.rationale}`,
    `Suggested fix: ${finding.suggestedFix}`,
    `Implementable: ${finding.canImplement ? "yes" : "no"}`,
  ].join("\n");
}

function severityClasses(severity: ReviewFinding["severity"]): string {
  switch (severity) {
    case "critical":
      return "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300";
    case "high":
      return "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300";
    case "medium":
      return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "low":
      return "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "info":
      return "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300";
  }
}

interface ReviewReportCardProps {
  report: ReviewReport;
  onImplementFinding?: (finding: ReviewFinding) => void;
  onImplementAll?: (findings: ReviewFinding[]) => void;
  onDismissAll?: () => void;
}

export const ReviewReportCard = memo(function ReviewReportCard({
  report,
  onImplementFinding,
  onImplementAll,
  onDismissAll,
}: ReviewReportCardProps) {
  const [dismissedTitles, setDismissedTitles] = useState<Record<string, boolean>>({});
  const [expandedTitles, setExpandedTitles] = useState<Record<string, boolean>>({});
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  const visibleFindings = useMemo(
    () => report.findings.filter((finding) => !dismissedTitles[finding.title]),
    [dismissedTitles, report.findings],
  );
  const exportMarkdown = useMemo(() => buildReviewExportMarkdown(report), [report]);

  const handleExport = () => {
    downloadReviewAsTextFile("review-report.md", exportMarkdown);
  };

  return (
    <div className="rounded-[24px] border border-border/80 bg-card/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="bg-teal-500/10 text-teal-700 dark:text-teal-300">
              Review
            </Badge>
            <p className="text-sm font-medium text-foreground">Review summary</p>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-foreground/90">{report.summary}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!onImplementAll || visibleFindings.length === 0}
            onClick={() => onImplementAll?.(visibleFindings)}
          >
            Implement all fixes
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDismissedTitles((current) => {
                const next = { ...current };
                for (const finding of visibleFindings) {
                  next[finding.title] = true;
                }
                return next;
              });
              onDismissAll?.();
            }}
          >
            Approve none
          </Button>
          <Button size="sm" variant="outline" onClick={handleExport}>
            Export review
          </Button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-border/70 bg-background/60 p-3">
        <p className="text-xs font-semibold tracking-widest text-muted-foreground/50 uppercase">
          Verdict
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">{report.verdict}</p>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold tracking-widest text-muted-foreground/50 uppercase">
            Findings
          </p>
          <span className="text-xs text-muted-foreground/60">{visibleFindings.length} visible</span>
        </div>

        {visibleFindings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/40 px-3 py-4 text-sm text-muted-foreground/75">
            No findings visible.
          </div>
        ) : null}

        {visibleFindings.map((finding) => {
          const expanded = Boolean(expandedTitles[finding.title]);
          return (
            <div
              key={`${finding.severity}:${finding.title}`}
              className="rounded-2xl border border-border/80 bg-background/70 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn("capitalize", severityClasses(finding.severity))}
                    >
                      {finding.severity}
                    </Badge>
                    <p className="text-sm font-medium text-foreground">{finding.title}</p>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-foreground/85">
                    {finding.rationale}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!onImplementFinding || !finding.canImplement}
                    onClick={() => onImplementFinding?.(finding)}
                  >
                    Implement fix
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(formatFindingCopyText(finding))}
                  >
                    {isCopied ? "Copied" : "Copy"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setDismissedTitles((existing) => ({ ...existing, [finding.title]: true }))
                    }
                  >
                    Dismiss
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setExpandedTitles((existing) => ({
                        ...existing,
                        [finding.title]: !existing[finding.title],
                      }))
                    }
                  >
                    {expanded ? "Hide details" : "More details"}
                  </Button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {finding.affectedFiles.length > 0 ? (
                  finding.affectedFiles.map((file) => (
                    <Badge key={file} variant="secondary" className="font-mono text-[11px]">
                      {file}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground/60">
                    No affected files listed.
                  </span>
                )}
              </div>

              {expanded ? (
                <div className="mt-3 rounded-xl border border-border/70 bg-muted/20 p-3 text-sm text-foreground/85">
                  <p className="font-medium">Suggested fix</p>
                  <p className="mt-1 leading-relaxed">{finding.suggestedFix}</p>
                  <p className="mt-3 text-xs text-muted-foreground/70">
                    {finding.canImplement
                      ? "This finding is eligible for implementation handoff."
                      : "This finding is review-only and should not be auto-implemented."}
                  </p>
                </div>
              ) : null}
            </div>
          );
        })}

        {report.openQuestions.length > 0 ? (
          <div className="rounded-2xl border border-border/80 bg-background/60 p-4">
            <p className="text-xs font-semibold tracking-widest text-muted-foreground/50 uppercase">
              Open questions
            </p>
            <ul className="mt-2 space-y-1 text-sm text-foreground/85">
              {report.openQuestions.map((question) => (
                <li key={question}>- {question}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
});
