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

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { kodoQuietLabel } from "@t3tools/shared/kodoOrchestrator";

import { Button } from "../components/ui/button";
import { useNowMinute } from "../hooks/useNowMinute";
import { useQuietThreadShell } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { useKodoQuietWorkerCount } from "./useKodoNeedsYou";
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
  const quiet = useKodoQuietWorkerCount(props.environmentId, props.threadId);
  const view = usage === null ? null : describeKodoDelegationUsage(usage);
  if (view === null && quiet === 0) return null;
  const parts = [view?.lead ?? null, view?.workers ?? null].filter(
    (part): part is string => part !== null,
  );
  return (
    <div data-kodo-delegation-bar data-kodo-lead-usage className={BAR_CLASS}>
      <BotIcon aria-hidden className="size-3.5 shrink-0" />
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
        {parts.length === 0 ? null : <span className="tabular-nums">{parts.join(" · ")}</span>}
        {view?.savings == null ? null : (
          <span className="font-medium text-foreground">{view.savings}</span>
        )}
        {quiet === 0 ? null : (
          // KODO: quiet-watch - the server's watchdog finds a worker's running turn silent
          <span data-kodo-quiet-workers className="font-medium text-warning-foreground">
            {quiet === 1 ? "1 worker quiet" : `${quiet} workers quiet`}
          </span>
        )}
      </div>
    </div>
  );
}

/** "Quiet for 7m" while the server's watchdog finds this worker's running turn silent; nothing otherwise. */
function WorkerQuiet(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
}) {
  const shell = useQuietThreadShell(
    props.threadId === null ? null : scopeThreadRef(props.environmentId, props.threadId),
  );
  const nowMinute = useNowMinute();
  if (shell?.kodoQuiet === undefined) return null;
  return (
    <>
      <span aria-hidden>·</span>
      <span data-kodo-worker-quiet className="font-medium text-warning-foreground">
        {kodoQuietLabel(shell.kodoQuiet.since, Date.parse(`${nowMinute}:00.000Z`))}
      </span>
    </>
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
        <WorkerQuiet environmentId={props.environmentId} threadId={props.threadId} />
      </div>
    </div>
  );
}
