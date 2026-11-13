// @effect-diagnostics nodeBuiltinImport:off
// The server's gate on the Orchestrator starting work: `delegate_task` raises an approval card on its
// own run (startRequest.ts) and waits for a person's answer, so the gate does not rest on the model.
// "Ask before the Orchestrator starts work" turns it off; agents cannot change that setting through the app's tools.
import {
  CommandId,
  type NodeId,
  type OrchestrationV2RuntimeRequest,
  type RunId,
  RuntimeRequestId,
  type ThreadId,
} from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";

import { isKodoStartRequest } from "./startRequest.ts";

type DepError = { readonly _tag?: string };

/**
 * What the person is asked: where the worker starts, in which mode (whose model slot it runs on),
 * to do what. The model is not named: a slot's model can fall back when the turn starts, and the
 * card must not promise one.
 */
export interface KodoStartSummary {
  readonly projectTitle: string;
  readonly projectId: string;
  readonly mode: string;
  readonly request: string;
}

/** The longest request the Orchestrator may ask to start: the card shows all of it, so a person can read all of it. */
const KODO_START_REQUEST_MAX_CHARS = 32_000;

/** Why a request is too long to put on a card, or undefined. */
export const kodoStartRequestRefusal = (request: string): string | undefined =>
  request.length > KODO_START_REQUEST_MAX_CHARS
    ? `The request is ${request.length} characters, over the ${KODO_START_REQUEST_MAX_CHARS} a person can be asked to approve. Shorten it, or split it into smaller tasks.`
    : undefined;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function kodoStartRequestText(summary: KodoStartSummary): {
  readonly prompt: string;
  readonly reason: string;
} {
  return {
    prompt: [
      `Project: ${summary.projectTitle} (${summary.projectId})`,
      `Mode: ${capitalize(summary.mode)}, on the ${capitalize(summary.mode)} model from Settings (the project's default model if that is not available)`,
      `Request: ${summary.request.trim()}`,
    ].join("\n"),
    reason: "The Orchestrator wants to start this worker. Nothing starts until you approve.",
  };
}

/** Binds a question's identity to what it shows: the same call with other content is another question. */
export const kodoStartContentDigest = (summary: KodoStartSummary): string =>
  NodeCrypto.createHash("sha256")
    .update(JSON.stringify([summary.projectId, summary.mode, summary.request]))
    .digest("hex")
    .slice(0, 24);

export type KodoStartAnswer =
  /** The setting is off: nothing was asked. */
  | "not-asked"
  | "approved"
  | "declined"
  /** The question was closed without an answer: its run was stopped, or the session ended. */
  | "withdrawn"
  | "unanswered"
  /** Another question is still open: only one is asked at a time, and nothing was asked. */
  | "busy";

type RecordCommand = {
  readonly type: "kodo.start-request.record";
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly nodeId: NodeId;
  readonly requestId: RuntimeRequestId;
  readonly outcome: "pending" | "cancelled";
  readonly prompt: string;
  readonly reason: string;
};

export interface KodoStartConfirmationDeps {
  /** The setting; a read that fails asks. */
  readonly askBefore: Effect.Effect<boolean>;
  readonly eventSequence: (threadId: ThreadId) => Effect.Effect<number, DepError>;
  /** Every runtime request of the thread, in any status. */
  readonly readRequests: (
    threadId: ThreadId,
  ) => Effect.Effect<ReadonlyArray<OrchestrationV2RuntimeRequest>, DepError>;
  readonly record: (command: RecordCommand) => Effect.Effect<unknown, DepError>;
  /** Waits for the request to leave pending, from events after `afterSequence`. */
  readonly settled: (input: {
    readonly threadId: ThreadId;
    readonly afterSequence: number;
    readonly requestId: RuntimeRequestId;
  }) => Effect.Effect<OrchestrationV2RuntimeRequest, DepError>;
  readonly timeout: Duration.Duration;
}

export const makeKodoStartConfirmation = (deps: KodoStartConfirmationDeps) => {
  // Reading the open questions and raising one go together, so two calls cannot both find none open.
  const asking = Semaphore.makeUnsafe(1);
  const confirm = Effect.fn("KodoStartConfirmation.confirm")(function* (input: {
    readonly threadId: ThreadId;
    readonly runId: RunId;
    /** The run's root node, which the card hangs from. */
    readonly rootNodeId: NodeId;
    readonly commandId: CommandId;
    readonly summary: KodoStartSummary;
  }) {
    if (!(yield* deps.askBefore)) return "not-asked" as const;
    const { threadId } = input;
    const text = kodoStartRequestText(input.summary);
    // A question already answered, withdrawn or expired is never replayed: a call that reaches here
    // has no receipt of a started worker, so it asks again under the next id. Only a question still
    // pending is joined, so a duplicate call waits on the one card.
    // The cursor comes before any read of the question, so an answer cannot land between asking and listening.
    const afterSequence = yield* deps.eventSequence(threadId);
    const baseId = `kodo-start:${input.commandId}:${kodoStartContentDigest(input.summary)}`;
    let requestId = RuntimeRequestId.make(baseId);
    const record = (outcome: RecordCommand["outcome"]) =>
      deps.record({
        type: "kodo.start-request.record",
        commandId: CommandId.make(`${requestId}:record:${outcome}`),
        threadId,
        runId: input.runId,
        nodeId: input.rootNodeId,
        requestId,
        outcome,
        ...text,
      });
    const withdraw = record("cancelled").pipe(Effect.ignore);
    const raise = asking.withPermits(1)(
      Effect.gen(function* () {
        const stored = yield* deps.readRequests(threadId);
        const byId = new Map(stored.map((request) => [request.id, request]));
        for (
          let attempt = 1;
          byId.get(requestId) !== undefined && byId.get(requestId)?.status !== "pending";
          attempt += 1
        ) {
          requestId = RuntimeRequestId.make(`${baseId}:${attempt}`);
        }
        if (byId.has(requestId)) return "joined" as const;
        // One question at a time: another call's open card must be answered before a different one is asked.
        if (stored.some((request) => request.status === "pending" && isKodoStartRequest(request))) {
          return "busy" as const;
        }
        yield* record("pending");
        return "raised" as const;
      }),
    );
    const outcome = yield* Effect.gen(function* () {
      if ((yield* raise) === "busy") return "busy" as const;
      return yield* deps
        .settled({ threadId, afterSequence, requestId })
        .pipe(Effect.timeoutOption(deps.timeout));
      // A stopped turn aborts the call, and a failure ends it: the question must not outlive either.
    }).pipe(Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : withdraw)));
    if (outcome === "busy") return "busy" as const;
    if (Option.isNone(outcome)) {
      yield* withdraw;
      return "unanswered" as const;
    }
    const request = outcome.value;
    if (request.status !== "resolved") return "withdrawn" as const;
    return request.decision === "accept" ? ("approved" as const) : ("declined" as const);
  });
  return { confirm } as const;
};

export type KodoStartConfirmation = ReturnType<typeof makeKodoStartConfirmation>;

/** What the Orchestrator is told when the worker did not start, so it can say so and not look for a way around. */
export const kodoStartRefusalMessage = (
  answer: Exclude<KodoStartAnswer, "approved" | "not-asked">,
  projectTitle: string,
): string => {
  switch (answer) {
    case "declined":
      return `The person declined to start this work in ${projectTitle}. Nothing was started. Tell them it was declined, and do not try another way.`;
    case "withdrawn":
      return `The question about starting work in ${projectTitle} was closed without an answer. Nothing was started. Ask the person again if they still want it.`;
    case "busy":
      return `Another question about starting work is still waiting for the person's answer. Nothing was started and nothing new was asked. Wait for their answer, then ask again if you still need this.`;
    case "unanswered":
      return `The person has not answered the question about starting work in ${projectTitle}. Nothing was started. Ask them again if they still want it.`;
  }
};
