import { useState, type ReactNode } from "react";
import { InlineButton } from "../components/ui/button";
import { kodoApprovalDetailView } from "./approvalDetail.logic";

/** An approval's detail, collapsed to its first lines when long, so the person can open all of what they approve. */
export function KodoApprovalDetail(props: {
  readonly text: string;
  readonly children: (detail: { readonly text: string; readonly complete: boolean }) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const view = kodoApprovalDetailView(props.text, expanded);
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      {props.children({ text: view.shown, complete: !view.collapsible || expanded })}
      {view.collapsible ? (
        <InlineButton tone="muted" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show less" : `Show all (${view.totalChars.toLocaleString()} characters)`}
        </InlineButton>
      ) : null}
    </div>
  );
}
