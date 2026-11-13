// The caps on delegation, as pure rules. A worker never starts workers, threads or loops; a lead has
// at most `maxWorkers` live workers and `KODO_SUB_AGENTS_MAX_WORKERS_PER_TURN` in one turn. The
// service layer reads the counts and asks these, so every route a lead can start work by is judged
// by the same words.
import {
  KODO_SUB_AGENTS_DEFAULT_MAX_WORKERS,
  KODO_SUB_AGENTS_MAX_WORKERS_LIMIT,
  KODO_SUB_AGENTS_MAX_WORKERS_PER_TURN,
} from "@t3tools/contracts";

export const KODO_WORKER_DEPTH_REFUSAL =
  "This thread is a worker of a lead, and workers do not start workers, threads or loops. Do the task yourself and report back, or say what you need from the lead.";

/** The setting's value as a usable cap: a whole number from 1 to the most the setting allows. */
export function kodoMaxWorkers(setting: unknown): number {
  return typeof setting === "number" && Number.isFinite(setting)
    ? Math.min(KODO_SUB_AGENTS_MAX_WORKERS_LIMIT, Math.max(1, Math.floor(setting)))
    : KODO_SUB_AGENTS_DEFAULT_MAX_WORKERS;
}

export interface KodoWorkerCounts {
  /** Workers of the lead that have not finished. */
  readonly live: number;
  /** Workers the lead started during its current turn. */
  readonly thisTurn: number;
}

/** Why a lead may not start `adding` more workers now, or undefined when it may. */
export function kodoWorkerCapRefusal(input: {
  readonly counts: KodoWorkerCounts;
  readonly maxWorkers: number;
  readonly adding?: number;
}): string | undefined {
  const adding = input.adding ?? 1;
  if (input.counts.live + adding > input.maxWorkers) {
    return `${input.counts.live} of ${input.maxWorkers} workers are still running, so starting ${adding === 1 ? "another" : `${adding} more`} would go over the limit. Wait for a result with task_status or t3_background_wait, then continue.`;
  }
  if (input.counts.thisTurn + adding > KODO_SUB_AGENTS_MAX_WORKERS_PER_TURN) {
    return `This turn has already started ${input.counts.thisTurn} workers, and ${KODO_SUB_AGENTS_MAX_WORKERS_PER_TURN} is the most for one turn. Report what the workers found and let the person decide how to continue.`;
  }
  return undefined;
}

/** The usage-limit gate's refusal for a worker's provider, in words the lead can pass on. */
export function kodoWorkerLimitRefusal(input: {
  readonly provider: string;
  readonly percent: number;
  readonly window: string;
  readonly stopAtPercent: number;
}): string | undefined {
  if (input.percent < input.stopAtPercent) return undefined;
  return `The ${input.window} usage limit of ${input.provider} is at ${Math.round(input.percent)}%, which is at or above the ${input.stopAtPercent}% the person set for starting work. No worker was started. Tell the person, and do not retry until they say the limit has room.`;
}

export const KODO_WORKER_LIMIT_UNREADABLE =
  "The usage limit of the worker's provider could not be read, so no worker was started. Tell the person; they can retry in a moment.";
