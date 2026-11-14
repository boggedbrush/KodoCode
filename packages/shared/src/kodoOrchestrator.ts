import {
  isKodoOrchestratorThreadId,
  kodoOrchestratorGeneration,
  type ModelSelection,
  type OrchestrationV2AppThreadLineage,
  type ServerProvider,
} from "@t3tools/contracts";

import { formatKodoMinutes } from "./kodoLoopLimits.ts";

// The Orchestrator's dot, as every client reads it: three states from the thread's shell. The dot is a
// static colour that changes only when the state does, never an animation.
export type KodoOrchestratorState = "idle" | "working" | "needs-you";

export const KODO_ORCHESTRATOR_STATE_LABEL: Readonly<Record<KodoOrchestratorState, string>> = {
  idle: "Idle",
  working: "Working",
  "needs-you": "Needs you",
};

interface OrchestratorStatusInput {
  readonly hasPendingApprovals?: boolean | undefined;
  readonly hasPendingUserInput?: boolean | undefined;
  /** The pending approval is the card asking whether to start a worker. */
  readonly pendingKodoStart?: boolean | undefined;
  /** A worker it started asks, and the question is answered in its conversation. */
  readonly pendingSubagentRequest?: string | null | undefined;
  readonly pendingGuestMessageCount?: number | undefined;
  readonly runtime?:
    | {
        readonly status?: string | undefined;
        readonly activityStartedAt?: string | null | undefined;
        readonly lastErrorClass?: string | null | undefined;
        readonly usageLimitResetAt?: string | null | undefined;
      }
    | null
    | undefined;
}

const RUNNING = new Set(["running", "waiting", "preparing", "starting", "queued"]);

/** What its workers are doing, as read from their shells: runs that are live, and what waits on a person. */
export interface KodoOrchestratorWorkers {
  readonly live: number;
  /** Workers with an approval waiting. */
  readonly approvals: number;
  /** Workers with a question waiting. */
  readonly questions: number;
  readonly needsYou: boolean;
}

export const NO_KODO_ORCHESTRATOR_WORKERS: KodoOrchestratorWorkers = {
  live: 0,
  approvals: 0,
  questions: 0,
  needsYou: false,
};

/** Why the Orchestrator needs a person, in the order the row names them. */
export type KodoOrchestratorReason =
  | "start-approval"
  | "approval"
  | "worker-approval"
  | "question"
  | "guest-message"
  | "usage-limit"
  | "error";

export function kodoOrchestratorReason(
  thread: OrchestratorStatusInput | null | undefined,
  workers: KodoOrchestratorWorkers = NO_KODO_ORCHESTRATOR_WORKERS,
): KodoOrchestratorReason | null {
  if (thread?.hasPendingApprovals === true) {
    return thread.pendingKodoStart === true ? "start-approval" : "approval";
  }
  if (workers.approvals > 0 || thread?.pendingSubagentRequest === "approval") {
    return "worker-approval";
  }
  if (
    thread?.hasPendingUserInput === true ||
    workers.questions > 0 ||
    (thread?.pendingSubagentRequest ?? null) !== null
  ) {
    return "question";
  }
  if ((thread?.pendingGuestMessageCount ?? 0) > 0) return "guest-message";
  if (thread?.runtime?.status === "failed") {
    return thread.runtime.lastErrorClass === "usage_limit" ? "usage-limit" : "error";
  }
  return null;
}

/**
 * What needs a person comes first, then what is running, from the Orchestrator's own shell and from its
 * workers': a question from a worker is the Orchestrator's to show, and a worker running while the
 * Orchestrator itself is idle (it started it and finished its turn) is still work in progress.
 * A thread that does not exist yet is idle.
 */
export function kodoOrchestratorState(
  thread: OrchestratorStatusInput | null | undefined,
  workers: KodoOrchestratorWorkers = NO_KODO_ORCHESTRATOR_WORKERS,
): KodoOrchestratorState {
  if (kodoOrchestratorReason(thread, workers) !== null) return "needs-you";
  return workers.live > 0 || RUNNING.has(thread?.runtime?.status ?? "") ? "working" : "idle";
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * The one line under the pinned row's title: why it needs a person, or what it is doing and for how
 * long. Elapsed time is whole minutes from the run's start, so it changes once a minute at most and
 * the caller needs no faster clock.
 */
export function kodoOrchestratorStatusLine(
  thread: OrchestratorStatusInput | null | undefined,
  workers: KodoOrchestratorWorkers,
  nowMs: number,
): string {
  switch (kodoOrchestratorReason(thread, workers)) {
    case "start-approval":
      return "Start approval";
    case "approval":
      return "Approval";
    case "worker-approval":
      return workers.approvals > 1 ? `${workers.approvals} worker approvals` : "Worker approval";
    case "question":
      return "Question";
    case "guest-message":
      return "Guest message";
    case "error":
      return "Error";
    case "usage-limit": {
      const resetsAt = thread?.runtime?.usageLimitResetAt;
      const resetMs = resetsAt == null ? Number.NaN : Date.parse(resetsAt);
      return Number.isFinite(resetMs) && resetMs > nowMs
        ? `Usage limit, resets in ${formatKodoMinutes(Math.max(1, Math.round((resetMs - nowMs) / 60_000)))}`
        : "Usage limit";
    }
    case null:
      break;
  }
  const status = thread?.runtime?.status ?? "";
  const own = RUNNING.has(status);
  const waiting = workers.live > 0 ? `waiting on ${plural(workers.live, "worker")}` : null;
  if (!own) return waiting === null ? "Idle" : `Waiting on ${plural(workers.live, "worker")}`;
  if (status === "queued") return waiting === null ? "Queued" : `Queued, ${waiting}`;
  const startedAt = thread?.runtime?.activityStartedAt;
  const startedMs = startedAt == null ? Number.NaN : Date.parse(startedAt);
  const minutes = Number.isFinite(startedMs) ? Math.floor((nowMs - startedMs) / 60_000) : -1;
  const working =
    minutes < 0 ? "Working" : `Working ${minutes < 1 ? "<1m" : formatKodoMinutes(minutes)}`;
  return waiting === null ? working : `${working}, ${waiting}`;
}

interface WorkerShell {
  readonly lineage: {
    readonly parentThreadId: string | null;
    readonly relationshipToParent?: string | null | undefined;
  };
  readonly runtime?: { readonly status?: string | undefined } | null | undefined;
  readonly hasPendingApprovals?: boolean | undefined;
  readonly hasPendingUserInput?: boolean | undefined;
}

/** Counts the workers of one Orchestrator conversation among `shells`: one pass, nothing read but the shell. */
export function kodoOrchestratorWorkerActivity(
  shells: Iterable<WorkerShell>,
  orchestratorThreadId: string | undefined,
): KodoOrchestratorWorkers {
  if (orchestratorThreadId === undefined) return NO_KODO_ORCHESTRATOR_WORKERS;
  let live = 0;
  let approvals = 0;
  let questions = 0;
  for (const shell of shells) {
    if (
      shell.lineage.relationshipToParent !== "subagent" ||
      shell.lineage.parentThreadId !== orchestratorThreadId
    ) {
      continue;
    }
    if (RUNNING.has(shell.runtime?.status ?? "")) live += 1;
    if (shell.hasPendingApprovals === true) approvals += 1;
    else if (shell.hasPendingUserInput === true) questions += 1;
  }
  return live === 0 && approvals === 0 && questions === 0
    ? NO_KODO_ORCHESTRATOR_WORKERS
    : { live, approvals, questions, needsYou: approvals + questions > 0 };
}

/** What waits on the person. */
export type KodoNeedsYouKind = "start-approval" | "approval" | "question" | "quiet";

export type KodoNeedsYouRole = "orchestrator" | "orchestrator-worker" | "lead" | "lead-worker";

export interface KodoNeedsYouItem {
  readonly threadId: string;
  readonly title: string;
  readonly kind: KodoNeedsYouKind;
  readonly role: KodoNeedsYouRole;
  /** The lead a worker belongs to, by title; absent for the Orchestrator, a lead, and its own workers. */
  readonly leadTitle?: string;
  /** For a quiet worker: when its last event was. */
  readonly quietSince?: string;
}

interface NeedsYouShell extends WorkerShell {
  readonly id: string;
  readonly title: string;
  readonly kodoLead?: { readonly kind: string } | null | undefined;
  readonly pendingKodoStart?: boolean | undefined;
  readonly pendingSubagentRequest?: string | null | undefined;
  /** The server's watchdog finds this worker's running turn silent. */
  readonly kodoQuiet?: { readonly since: string } | null | undefined;
}

const NEEDS_YOU_RANK: Readonly<Record<KodoNeedsYouKind, number>> = {
  "start-approval": 0,
  approval: 1,
  question: 2,
  quiet: 3,
};

const NEEDS_YOU_LABEL: Readonly<Record<KodoNeedsYouKind, string>> = {
  "start-approval": "Start approval",
  approval: "Approval",
  question: "Question",
  quiet: "Quiet",
};

/** How a row reads: what it waits for, and whose it is. */
export function kodoNeedsYouRowView(item: KodoNeedsYouItem): {
  readonly label: string;
  readonly context: string;
} {
  const context =
    item.role === "orchestrator"
      ? "Orchestrator"
      : item.role === "orchestrator-worker"
        ? "Worker of the Orchestrator"
        : item.role === "lead"
          ? "Leads sub-agents"
          : `Worker of ${item.leadTitle ?? "a lead"}`;
  return { label: NEEDS_YOU_LABEL[item.kind], context };
}

type RequestFamily = "approval" | "question";

/**
 * What a shell waits for. A request a descendant raised reaches every ancestor as
 * `pendingSubagentRequest`; `covered` holds the families a listed child of this shell already
 * answers for, so one request is one row, on the thread that raised it.
 */
const needsYouKind = (
  shell: NeedsYouShell,
  covered: ReadonlySet<RequestFamily> = new Set(),
): KodoNeedsYouKind | null => {
  if (shell.hasPendingApprovals === true) {
    return shell.pendingKodoStart === true ? "start-approval" : "approval";
  }
  if (shell.hasPendingUserInput === true) return "question";
  if (shell.pendingSubagentRequest === "approval" && !covered.has("approval")) return "approval";
  if (
    shell.pendingSubagentRequest != null &&
    shell.pendingSubagentRequest !== "approval" &&
    !covered.has("question")
  ) {
    return "question";
  }
  return shell.kodoQuiet == null ? null : "quiet";
};

const requestFamily = (kind: KodoNeedsYouKind): RequestFamily | null =>
  kind === "quiet" ? null : kind === "question" ? "question" : "approval";

/** "Quiet for 7m": how long a flagged worker has made no event, in whole minutes from the flag's `since`. */
export function kodoQuietLabel(since: string, nowMs: number): string {
  const sinceMs = Date.parse(since);
  const minutes = Number.isFinite(sinceMs) ? Math.floor((nowMs - sinceMs) / 60_000) : 0;
  return minutes < 1 ? "Quiet" : `Quiet for ${formatKodoMinutes(minutes)}`;
}

/**
 * Everything waiting on the person across the Orchestrator, the workers it started, the threads that
 * lead sub-agents, and their workers: one row per thread, a start card first, then approvals, then
 * questions. Read from the shells alone, so it follows what a person sees on a card and nothing the
 * agents say. `shells` should hold the Orchestrator's own shell too; it is hidden from ordinary lists.
 */
export function kodoNeedsYouItems(
  shells: Iterable<NeedsYouShell>,
  orchestratorThreadId: string | undefined,
): ReadonlyArray<KodoNeedsYouItem> {
  const all = [...shells];
  const leads = new Map(
    all.filter((shell) => shell.kodoLead?.kind === "sub-agents").map((lead) => [lead.id, lead]),
  );
  const roleOf = (shell: NeedsYouShell) => {
    const parentId = shell.lineage.parentThreadId;
    const isWorker = shell.lineage.relationshipToParent === "subagent" && parentId !== null;
    const parentLead = isWorker ? leads.get(parentId) : undefined;
    const role: KodoNeedsYouRole | null =
      shell.id === orchestratorThreadId
        ? "orchestrator"
        : isWorker && parentId === orchestratorThreadId
          ? "orchestrator-worker"
          : parentLead !== undefined
            ? "lead-worker"
            : leads.has(shell.id)
              ? "lead"
              : null;
    return { role, parentLead, parentId: isWorker ? parentId : null };
  };
  // The requests a listed worker already shows, by the thread it works for.
  const coveredBy = new Map<string, Set<RequestFamily>>();
  for (const shell of all) {
    const { role, parentId } = roleOf(shell);
    const kind = needsYouKind(shell);
    const family = kind === null ? null : requestFamily(kind);
    if (role === null || parentId === null || family === null) continue;
    const covered = coveredBy.get(parentId) ?? new Set<RequestFamily>();
    covered.add(family);
    coveredBy.set(parentId, covered);
  }
  const items: KodoNeedsYouItem[] = [];
  for (const shell of all) {
    const kind = needsYouKind(shell, coveredBy.get(shell.id));
    const { role, parentLead } = roleOf(shell);
    if (kind === null || role === null) continue;
    items.push({
      threadId: shell.id,
      title: shell.title,
      kind,
      role,
      ...(parentLead === undefined ? {} : { leadTitle: parentLead.title }),
      ...(kind === "quiet" && shell.kodoQuiet != null ? { quietSince: shell.kodoQuiet.since } : {}),
    });
  }
  return [...items].sort(
    (a, b) =>
      NEEDS_YOU_RANK[a.kind] - NEEDS_YOU_RANK[b.kind] ||
      a.title.localeCompare(b.title) ||
      a.threadId.localeCompare(b.threadId),
  );
}

/** The conversation among `threadIds` that is the Orchestrator's current one: the newest of its series. */
export function latestKodoOrchestratorThreadId(threadIds: Iterable<string>): string | undefined {
  let latest: { readonly id: string; readonly generation: number } | undefined;
  for (const id of threadIds) {
    const generation = kodoOrchestratorGeneration(id);
    if (generation !== undefined && (latest === undefined || generation > latest.generation)) {
      latest = { id, generation };
    }
  }
  return latest?.id;
}

/**
 * A worker the Orchestrator started. Its parent is hidden from every list, so it is not shown under
 * it: it is listed in the project it works in like any thread, where it can be seen and stopped.
 */
export const isKodoOrchestratorWorkerLineage = (
  lineage: Pick<OrchestrationV2AppThreadLineage, "parentThreadId" | "relationshipToParent">,
): boolean =>
  lineage.relationshipToParent === "subagent" &&
  lineage.parentThreadId !== null &&
  isKodoOrchestratorThreadId(lineage.parentThreadId);

/**
 * Why the Orchestrator cannot run on the model it would use (its own model setting, else the default),
 * or null when it can or when that cannot be told yet. The server decides the same thing when it opens
 * it, with the same wording for a missing default; this is the preview the row and Settings show.
 */
export function kodoOrchestratorUnavailableReason(input: {
  readonly model: Pick<ModelSelection, "instanceId"> | null | undefined;
  readonly providers: ReadonlyArray<
    Pick<ServerProvider, "instanceId" | "displayName" | "driver" | "kodoSubAgents">
  >;
}): string | null {
  if (input.model === null || input.model === undefined) {
    return "Choose a default model in Settings before opening the Orchestrator.";
  }
  const provider = input.providers.find(
    (candidate) => candidate.instanceId === input.model?.instanceId,
  );
  const support = provider?.kodoSubAgents;
  if (provider === undefined || support === undefined || support.support !== "none") return null;
  return `The Orchestrator can't run on ${provider.displayName ?? provider.driver}. ${support.reason ?? "It cannot receive the T3 tools."} Change its model in Settings.`;
}
