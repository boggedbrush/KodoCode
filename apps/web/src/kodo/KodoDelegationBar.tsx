import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  KodoLead,
  OrchestrationV2Subagent,
  ThreadId,
} from "@t3tools/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { ArrowUpLeftIcon, BotIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "../components/ui/button";
import { serverEnvironment } from "../state/server";
import {
  describeKodoDelegationUsage,
  kodoUsageRefreshKey,
  kodoWorkerModeLabel,
  kodoWorkerOf,
} from "./delegationBar.logic";

const BAR_CLASS =
  "flex min-h-8 shrink-0 items-center gap-2 border-b border-border/60 bg-background pl-(--workspace-gutter-start) pr-(--workspace-gutter-end) text-xs text-muted-foreground";

function LeadUsageLine(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly subagents: ReadonlyArray<OrchestrationV2Subagent> | null;
}) {
  const atom = serverEnvironment.kodoDelegationUsage({
    environmentId: props.environmentId,
    input: { threadId: props.threadId },
  });
  const refresh = useAtomRefresh(atom);
  const key = kodoUsageRefreshKey(props.subagents);
  // The atom reads once when it mounts; only a worker starting or finishing after that is a reason to read again.
  const readFor = useRef(key);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- re-reads server-held usage when a worker starts or finishes
  useEffect(() => {
    if (readFor.current === key) return;
    readFor.current = key;
    refresh();
  }, [key, refresh]);
  const usage = AsyncResult.getOrElse(useAtomValue(atom), () => null);
  const view = usage === null ? null : describeKodoDelegationUsage(usage);
  if (view === null) return null;
  const parts = [view.lead, view.workers].filter((part): part is string => part !== null);
  return (
    <div data-kodo-delegation-bar data-kodo-lead-usage className={BAR_CLASS}>
      <BotIcon aria-hidden className="size-3.5 shrink-0" />
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
        <span className="tabular-nums">{parts.join(" · ")}</span>
        {view.savings === null ? null : (
          <span className="font-medium text-foreground">{view.savings}</span>
        )}
      </div>
    </div>
  );
}

/**
 * One quiet line under the thread header. A worker says whose it is (with a way back), its mode and
 * its model; a lead says what it and its workers spent, and what delegating saved. Nothing for any
 * other thread.
 */
export function KodoDelegationBar(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly lead: KodoLead | null | undefined;
  readonly relationshipToParent: string | null | undefined;
  readonly parent: {
    readonly title: string;
    readonly kodoLead?: KodoLead | null | undefined;
  } | null;
  readonly onOpenParent: (() => void) | null;
  readonly mode: unknown;
  readonly modelLabel: string;
  readonly subagents: ReadonlyArray<OrchestrationV2Subagent> | null;
}) {
  const worker = kodoWorkerOf({
    relationshipToParent: props.relationshipToParent,
    parent: props.parent,
  });
  if (worker === null) {
    // KODO: swarm-delegate - the Orchestrator shows the same line: what it and its workers spent
    return props.lead != null && props.threadId !== null ? (
      <LeadUsageLine
        environmentId={props.environmentId}
        threadId={props.threadId}
        subagents={props.subagents}
      />
    ) : null;
  }
  return (
    <div data-kodo-delegation-bar data-kodo-worker-header className={BAR_CLASS}>
      <BotIcon aria-hidden className="size-3.5 shrink-0" />
      <div className="flex min-w-0 flex-wrap items-center gap-x-2">
        <span>Worker of</span>
        {props.onOpenParent === null ? (
          <span className="truncate font-medium text-foreground">{worker.leadTitle}</span>
        ) : (
          <span className="flex min-w-0 max-w-64">
            <Button size="micro" variant="link" onClick={props.onOpenParent}>
              <ArrowUpLeftIcon />
              <span className="truncate">{worker.leadTitle}</span>
            </Button>
          </span>
        )}
        <span aria-hidden>·</span>
        <span>{kodoWorkerModeLabel(props.mode)}</span>
        <span aria-hidden>·</span>
        <span className="truncate">{props.modelLabel}</span>
      </div>
    </div>
  );
}
