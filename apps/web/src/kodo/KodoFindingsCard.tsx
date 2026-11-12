import type { KodoReviewResult, KodoReviewSeverity } from "@t3tools/contracts";

import { ComposerBanner } from "../components/chat/ComposerBanner";
import { Badge } from "../components/ui/badge";
import { KodoInlineText } from "./KodoInlineText";
import { kodoFindingLocation, sortKodoFindings } from "./reviewFindings.logic";

const SEVERITY_BADGE = {
  high: { label: "High", variant: "error" },
  medium: { label: "Medium", variant: "warning" },
  low: { label: "Low", variant: "secondary" },
} as const satisfies Record<KodoReviewSeverity, { label: string; variant: string }>;

/** A review's findings, most serious first, with where each one is and what is wrong. */
export function KodoFindingsCard(props: { readonly review: KodoReviewResult }) {
  const findings = sortKodoFindings(props.review.findings);
  if (findings.length === 0) return null;
  return (
    <ComposerBanner.Scroll>
      <ul role="list" aria-label="Review findings" data-kodo-findings className="grid gap-1 py-1">
        {findings.map((finding) => {
          const badge = SEVERITY_BADGE[finding.severity];
          const location = kodoFindingLocation(finding);
          return (
            <li key={finding.id} className="grid gap-0.5 ps-8 pe-3 sm:ps-7">
              <div className="flex min-w-0 items-center gap-1.5">
                <Badge size="sm" variant={badge.variant}>
                  {badge.label}
                </Badge>
                <span className="min-w-0 truncate font-medium">
                  <KodoInlineText text={finding.title} />
                </span>
                {location === null ? null : (
                  <code className="shrink-0 text-muted-foreground">{location}</code>
                )}
              </div>
              <p className="text-muted-foreground wrap-anywhere">
                <KodoInlineText text={finding.detail} />
              </p>
              {finding.fix === undefined ? null : (
                <p className="text-muted-foreground wrap-anywhere">
                  Fix: <KodoInlineText text={finding.fix} />
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </ComposerBanner.Scroll>
  );
}
