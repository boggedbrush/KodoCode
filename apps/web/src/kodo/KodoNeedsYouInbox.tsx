import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ProviderApprovalOption,
  type ThreadId,
} from "@t3tools/contracts";
import {
  kodoNeedsYouRowView,
  kodoQuietLabel,
  type KodoNeedsYouItem,
} from "@t3tools/shared/kodoOrchestrator";
import { useNavigate } from "@tanstack/react-router";
import { InboxIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { ComposerPendingApprovalActions } from "../components/chat/ComposerPendingApprovalActions";
import { Badge } from "../components/ui/badge";
import { Button, InlineButton } from "../components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { useNowMinute } from "../hooks/useNowMinute";
import { useEnvironmentScope } from "../state/session";
import { environmentThreadDetails } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";
import { kodoApprovalDetailView } from "./approvalDetail.logic";
import { kodoInboxApprovalCommand } from "./needsYouCommand";
import {
  getKodoInboxOpen,
  registerKodoInboxHost,
  setKodoInboxOpen,
  subscribeKodoInbox,
} from "./orchestrator.logic";

// Approve and Decline only: "always allow" would outlive what the person read here.
const INBOX_DEFAULT_OPTIONS = [
  { decision: "decline", label: "Decline" },
  { decision: "accept", label: "Approve" },
] satisfies ReadonlyArray<ProviderApprovalOption>;

/**
 * One approval of a thread that is waiting, answered with the command its own card uses
 * (`kodoInboxApprovalCommand`), so the inbox is another place to press the same buttons and
 * never another way to approve. A request too long to read here is left to the thread's card.
 */
function InboxApproval(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const ref = scopeThreadRef(props.environmentId, props.threadId);
  const approval = useAtomValue(environmentThreadDetails.pendingRequestsAtom(ref))?.approvals[0];
  const canRespond = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);
  const respond = useAtomCommand(kodoInboxApprovalCommand, { reportFailure: false });
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (approval === undefined) return null;
  const text = approval.detail ?? approval.requestKind;
  const view = kodoApprovalDetailView(text, false);
  return (
    <div className="mt-1.5 flex min-w-0 flex-col gap-1.5">
      <pre
        data-kodo-inbox-detail
        className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground"
      >
        {view.shown}
        {view.collapsible ? "…" : ""}
      </pre>
      {view.collapsible || approval.responseCapability !== "live" ? (
        <p className="text-xs text-muted-foreground">
          {approval.responseCapability !== "live"
            ? "The provider process is gone. Open the thread to respond."
            : "Open the thread to read all of this before you answer."}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <ComposerPendingApprovalActions
            presentation="inline"
            requestId={approval.requestId}
            isResponding={responding}
            canRespond
            disabled={!canRespond}
            options={(approval.options ?? INBOX_DEFAULT_OPTIONS).filter(
              (option) => option.decision === "accept" || option.decision === "decline",
            )}
            onRespondToApproval={async (requestId, decision) => {
              if (!canRespond || responding) return;
              setResponding(true);
              setError(null);
              const result = await respond({
                environmentId: props.environmentId,
                input: { threadId: props.threadId, requestId, decision },
              });
              if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                const failure = squashAtomCommandFailure(result);
                setError(
                  failure instanceof Error
                    ? failure.message
                    : "Failed to submit approval decision.",
                );
              }
              setResponding(false);
              return result;
            }}
          />
        </div>
      )}
      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function InboxRow(props: {
  readonly environmentId: EnvironmentId;
  readonly item: KodoNeedsYouItem;
  readonly onOpen: () => void;
}) {
  const { item } = props;
  const nowMinute = useNowMinute();
  const view = kodoNeedsYouRowView(item);
  const label =
    item.kind === "quiet" && item.quietSince !== undefined
      ? kodoQuietLabel(item.quietSince, Date.parse(`${nowMinute}:00.000Z`))
      : view.label;
  return (
    <li
      data-kodo-inbox-row={item.kind}
      className="flex min-w-0 flex-col border-b border-border/60 px-3 py-2 last:border-b-0"
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{item.title}</span>
          <span className="truncate text-xs text-muted-foreground">
            {label} · {view.context}
          </span>
        </div>
        <InlineButton tone="muted" onClick={props.onOpen}>
          Open
        </InlineButton>
      </div>
      {item.kind === "approval" || item.kind === "start-approval" ? (
        <InboxApproval environmentId={props.environmentId} threadId={item.threadId as ThreadId} />
      ) : null}
    </li>
  );
}

/**
 * The "Needs you" popover on the pinned row: everything waiting on the person across the Orchestrator,
 * its workers and the sub-agent leads. A badge counts it; the palette and a keybinding open the same one.
 */
export function KodoNeedsYouInbox(props: {
  readonly environmentId: EnvironmentId;
  readonly items: ReadonlyArray<KodoNeedsYouItem>;
}) {
  const open = useSyncExternalStore(subscribeKodoInbox, getKodoInboxOpen, () => false);
  const navigate = useNavigate();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers this row as the inbox's host with the palette and keybinding, which live outside React's tree
  useEffect(() => registerKodoInboxHost(), []);
  const count = props.items.length;
  return (
    <Popover open={open} onOpenChange={setKodoInboxOpen}>
      <PopoverTrigger
        data-kodo-inbox-trigger
        aria-label={count === 0 ? "Needs you, nothing waiting" : `Needs you, ${count} waiting`}
        render={<Button size="xs" variant="ghost-muted" />}
      >
        <InboxIcon aria-hidden className="size-3.5" />
        {count === 0 ? null : (
          <Badge data-kodo-inbox-count variant="warning" size="sm">
            {count}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverPopup side="right" align="start" width="md" padding="none">
        <div data-kodo-inbox className="flex w-full min-w-0 flex-col">
          <h2 className="px-3 pt-2.5 pb-1.5 text-xs font-medium text-muted-foreground">
            Needs you
          </h2>
          {count === 0 ? (
            <p className="px-3 pb-3 text-sm text-muted-foreground">Nothing is waiting on you.</p>
          ) : (
            <ul className="max-h-[min(28rem,70vh)] overflow-y-auto">
              {props.items.map((item) => (
                <InboxRow
                  key={item.threadId}
                  environmentId={props.environmentId}
                  item={item}
                  onOpen={() => {
                    setKodoInboxOpen(false);
                    void navigate({
                      to: "/$environmentId/$threadId",
                      params: buildThreadRouteParams(
                        scopeThreadRef(props.environmentId, item.threadId as ThreadId),
                      ),
                    });
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
