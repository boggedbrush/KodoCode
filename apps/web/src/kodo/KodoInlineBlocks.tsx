import type { KodoLoopVerdict, KodoReviewResult } from "@t3tools/contracts";

import { Badge } from "../components/ui/badge";
import { KodoInlineText } from "./KodoInlineText";
import { kodoFindingLocation, kodoFindingsTitle, sortKodoFindings } from "./reviewFindings.logic";

const SEVERITY_BADGE = {
  high: { label: "High", variant: "error" },
  medium: { label: "Medium", variant: "warning" },
  low: { label: "Low", variant: "secondary" },
} as const;

/** A review's findings inside its own reply: compact, with no action. The newest one has the card. */
export function KodoInlineFindings(props: { readonly review: KodoReviewResult }) {
  const findings = sortKodoFindings(props.review.findings);
  return (
    <div
      data-kodo-inline-findings
      className="my-2 grid gap-1 rounded-md border bg-muted/30 px-3 py-2 text-sm"
    >
      <div className="font-medium">{kodoFindingsTitle(props.review)}</div>
      {props.review.summary.length === 0 ? null : (
        <p className="text-muted-foreground">
          <KodoInlineText text={props.review.summary} />
        </p>
      )}
      {findings.length === 0 ? null : (
        <ul role="list" className="grid gap-1">
          {findings.map((finding) => {
            const badge = SEVERITY_BADGE[finding.severity];
            const location = kodoFindingLocation(finding);
            return (
              <li key={finding.id} className="grid gap-0.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Badge size="sm" variant={badge.variant}>
                    {badge.label}
                  </Badge>
                  <span className="min-w-0 font-medium wrap-anywhere">
                    <KodoInlineText text={finding.title} />
                  </span>
                  {location === null ? null : (
                    <code className="shrink-0 text-muted-foreground text-xs">{location}</code>
                  )}
                </div>
                <p className="text-muted-foreground wrap-anywhere">
                  <KodoInlineText text={finding.detail} />
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The Judge's verdict inside its own reply: complete or not, and what is still outstanding. */
export function KodoInlineVerdict(props: { readonly verdict: KodoLoopVerdict }) {
  const { verdict } = props;
  return (
    <div
      data-kodo-inline-verdict
      className="my-2 grid gap-1 rounded-md border bg-muted/30 px-3 py-2 text-sm"
    >
      <div className="font-medium">{verdict.complete ? "Complete" : "Not complete"}</div>
      {verdict.summary.length === 0 ? null : (
        <p className="text-muted-foreground">
          <KodoInlineText text={verdict.summary} />
        </p>
      )}
      {verdict.outstanding.length === 0 ? null : (
        <ul role="list" className="grid gap-1">
          {verdict.outstanding.map((item) => (
            <li key={item.id} className="grid gap-0.5">
              <span className="font-medium wrap-anywhere">
                <KodoInlineText text={item.title} />
              </span>
              <span className="text-muted-foreground wrap-anywhere">
                <KodoInlineText text={item.detail} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
