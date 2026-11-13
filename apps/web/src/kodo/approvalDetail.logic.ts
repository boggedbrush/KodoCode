// How much of an approval's detail shows before a person expands it. The Orchestrator's start card
// carries the whole request, so a long one is collapsed to its first lines, never cut.
const COLLAPSED_LINES = 6;
const COLLAPSED_CHARS = 600;

export interface KodoApprovalDetailView {
  /** What shows now. */
  readonly shown: string;
  /** More text exists than `shown`; a way to read it all is offered. */
  readonly collapsible: boolean;
  readonly totalChars: number;
}

export function kodoApprovalDetailView(text: string, expanded: boolean): KodoApprovalDetailView {
  const lines = text.split("\n");
  const collapsible = lines.length > COLLAPSED_LINES || text.length > COLLAPSED_CHARS;
  if (!collapsible || expanded) return { shown: text, collapsible, totalChars: text.length };
  return {
    shown: lines.slice(0, COLLAPSED_LINES).join("\n").slice(0, COLLAPSED_CHARS),
    collapsible,
    totalChars: text.length,
  };
}
