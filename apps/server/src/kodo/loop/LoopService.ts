// The loop's control surface: start, stop, approve, extend, retry the judge, status. The `/loop`
// intercept and the handlers call these; the orchestrator enforces the same rules under the lock.
import {
  CommandId,
  DEFAULT_KODO_LOOP_SETTINGS,
  type KodoLoop,
  type KodoLoopBudget,
  KODO_LOOP_REQUEST_MAX_CHARS,
  type KodoLoopControl,
  type KodoLoopSettings,
  type MessageId,
  type OrchestrationV2Command,
  type OrchestrationV2ServerCommand,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import { OrchestratorDispatchError } from "../../orchestration-v2/Orchestrator.ts";
import { parseLoopCommand } from "./loopCommand.ts";
import { isKodoLoopAutomatedMessage } from "./loopControl.ts";
import { isKodoLoopTerminal } from "./loopState.ts";

type MessageDispatchCommand = Extract<
  OrchestrationV2Command,
  { readonly type: "message.dispatch" }
>;

export interface KodoLoopServiceDeps {
  readonly orchestrator: Pick<
    Orchestrator.OrchestratorV2["Service"],
    "dispatch" | "getThreadRecords"
  >;
  readonly serverSettings: {
    readonly getSettings: Effect.Effect<
      { readonly loop: KodoLoopSettings },
      { readonly _tag: string }
    >;
  };
}

/** One line saying where a loop stands, for `/loop status` and for the person reading a stop. */
function describeKodoLoop(loop: KodoLoop): string {
  const place = `round ${loop.round} of ${loop.maxRounds}, ${loop.stage} stage`;
  switch (loop.status) {
    case "active":
      return `The loop is running: ${place}.`;
    case "held":
      return loop.hold === "plan_approval"
        ? `The loop is waiting for you to approve the plan: ${place}.`
        : `The loop is waiting for a request to be answered: ${place}.`;
    case "done":
      return `The loop finished: the request is complete after ${loop.round} round${loop.round === 1 ? "" : "s"}.`;
    case "stopped":
    case "failed":
      return `The loop stopped (${loop.stopReason ?? "unknown"}) at ${place}.${loop.stopDetail === undefined ? "" : ` ${loop.stopDetail}`}`;
  }
}

/** Whether a `/loop ...` message is a person's (or an agent's) to act on, not one the server sent. */
const isControlText = (command: MessageDispatchCommand) =>
  command.kodoLoopStage === undefined &&
  command.guestMessageId === undefined &&
  !isKodoLoopAutomatedMessage(command);

/**
 * The outcome of a `/loop` command, carried in the failure `sendToThread` ends with (no turn started,
 * so there is no message or run to return). `sendToThreadOrLoop` turns it back into an answer.
 */
export class KodoLoopSendNote {
  readonly note: string;
  readonly dispatch: Orchestrator.OrchestratorV2DispatchResult | undefined;
  readonly message: string;
  constructor(note: string, dispatch: Orchestrator.OrchestratorV2DispatchResult | undefined) {
    this.note = note;
    this.dispatch = dispatch;
    this.message = `That was a /loop command, which starts no turn. ${note}`;
  }
}

export interface KodoLoopSendOutcome {
  readonly note: string;
  readonly dispatch: Orchestrator.OrchestratorV2DispatchResult | undefined;
}

export const makeKodoLoopService = (deps: KodoLoopServiceDeps) => {
  const { orchestrator, serverSettings } = deps;

  const refuse = (commandId: CommandId, commandType: string, message: string) =>
    new OrchestratorDispatchError({ commandId, commandType, cause: message });

  const control = (input: {
    readonly threadId: ThreadId;
    readonly commandId: CommandId;
    readonly control: KodoLoopControl;
  }) =>
    orchestrator.dispatch({
      type: "thread.kodo-loop.control",
      commandId: input.commandId,
      threadId: input.threadId,
      control: input.control,
    });

  const currentLoop = (threadId: ThreadId) =>
    orchestrator.getThreadRecords(threadId, []).pipe(Effect.map(({ thread }) => thread.kodoLoop));

  const start = Effect.fn("KodoLoopService.start")(function* (input: {
    readonly threadId: ThreadId;
    readonly commandId: CommandId;
    readonly requestMessageId: MessageId;
    readonly request: string;
    readonly maxRounds?: number | undefined;
    readonly requestMessage?: Extract<
      KodoLoopControl,
      { readonly type: "start" }
    >["requestMessage"];
  }) {
    // Unreadable settings mean the defaults, never a loop that cannot start.
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.map(({ loop }) => loop),
      Effect.orElseSucceed(() => DEFAULT_KODO_LOOP_SETTINGS),
    );
    const budget: KodoLoopBudget = {
      stopAtLimitPercent: settings.budget.stopAtLimitPercent,
      ...(settings.budget.maxCostUsd === null ? {} : { maxCostUsd: settings.budget.maxCostUsd }),
      ...(settings.budget.maxTokens === null ? {} : { maxTokens: settings.budget.maxTokens }),
    };
    return yield* control({
      threadId: input.threadId,
      commandId: input.commandId,
      control: {
        type: "start",
        request: input.request,
        requestMessageId: input.requestMessageId,
        ...(input.requestMessage === undefined ? {} : { requestMessage: input.requestMessage }),
        maxRounds: input.maxRounds ?? settings.defaultMaxRounds,
        planApproval: settings.planApproval,
        budget,
      },
    });
  });

  const stop = Effect.fn("KodoLoopService.stop")(function* (input: {
    readonly threadId: ThreadId;
    readonly commandId: CommandId;
    readonly detail?: string;
  }) {
    const loop = yield* currentLoop(input.threadId);
    if (loop === undefined || isKodoLoopTerminal(loop.status)) {
      return yield* refuse(
        input.commandId,
        "thread.kodo-loop.control",
        "No loop is running on this thread.",
      );
    }
    return yield* control({
      ...input,
      control: { type: "stop", ...(input.detail === undefined ? {} : { detail: input.detail }) },
    });
  });

  const approve = Effect.fn("KodoLoopService.approve")(function* (input: {
    readonly threadId: ThreadId;
    readonly commandId: CommandId;
  }) {
    return yield* control({ ...input, control: { type: "approve" } });
  });

  const retryJudge = Effect.fn("KodoLoopService.retryJudge")(function* (input: {
    readonly threadId: ThreadId;
    readonly commandId: CommandId;
  }) {
    return yield* control({ ...input, control: { type: "retry-judge" } });
  });

  const extend = Effect.fn("KodoLoopService.extend")(function* (input: {
    readonly threadId: ThreadId;
    readonly commandId: CommandId;
    readonly rounds: number;
  }) {
    return yield* control({
      threadId: input.threadId,
      commandId: input.commandId,
      control: { type: "extend", rounds: input.rounds },
    });
  });

  const status = Effect.fn("KodoLoopService.status")(function* (threadId: ThreadId) {
    const loop = yield* currentLoop(threadId);
    return loop === undefined ? "There is no loop on this thread." : describeKodoLoop(loop);
  });

  const requestMessageOf = (command: MessageDispatchCommand) =>
    ({
      text: command.text.slice(0, KODO_LOOP_REQUEST_MAX_CHARS + 200),
      createdBy: command.createdBy,
      creationSource: command.creationSource,
      ...(command.scheduledTaskId === undefined
        ? {}
        : { scheduledTaskId: command.scheduledTaskId }),
      ...(command.senderThreadId === undefined ? {} : { senderThreadId: command.senderThreadId }),
    }) as const;

  /**
   * What a `/loop` message does, or undefined when the message is anything else. The message itself is
   * not sent as a turn: a start records it as a row of the thread and the loop's stage messages carry
   * the request on. `status` and an invalid command come back as `info` and `refusal`, so the caller
   * decides how to say them.
   */
  const messageControl = (command: OrchestrationV2ServerCommand) => {
    if (command.type !== "message.dispatch" || !isControlText(command)) return undefined;
    const parsed = parseLoopCommand(command.text);
    if (parsed === null) return undefined;
    const { threadId, commandId } = command;
    if (command.attachments.length > 0) {
      return {
        kind: "refusal",
        message: "A /loop command takes text only; send it again without attachments.",
      } as const;
    }
    switch (parsed.type) {
      case "invalid":
        return { kind: "refusal", message: parsed.message } as const;
      case "status":
        return { kind: "info", read: status(threadId) } as const;
      case "stop":
        return {
          kind: "stop",
          note: "The loop was stopped." as string,
          run: stop({ threadId, commandId }),
          running: currentLoop(threadId).pipe(
            Effect.map((loop) => loop !== undefined && !isKodoLoopTerminal(loop.status)),
          ),
        } as const;
      case "start":
        return {
          kind: "run",
          note: `The loop started: it plans, codes, reviews and judges in rounds, and the thread reports where it stands.`,
          run: start({
            threadId,
            commandId,
            requestMessageId: command.messageId,
            request: parsed.request,
            maxRounds: parsed.maxRounds,
            requestMessage: requestMessageOf(command),
          }),
        } as const;
    }
  };

  /** The dispatch a `/loop` message stands for, as the message funnel returns it. */
  const intercept = (command: OrchestrationV2ServerCommand) => {
    const decided = messageControl(command);
    if (decided === undefined) return undefined;
    const fail = (message: string) => Effect.fail(refuse(command.commandId, command.type, message));
    switch (decided.kind) {
      case "refusal":
        return fail(decided.message);
      // No turn is sent for a status, so the answer travels as the message's refusal.
      case "info":
        return decided.read.pipe(Effect.flatMap(fail));
      case "run":
      case "stop":
        return decided.run;
    }
  };

  /**
   * The same for a sender that wants an answer, not a dispatch result (an agent's send, a scheduled
   * task): the outcome in words, and nothing else. Starting, stopping and reading a loop are all
   * successes here; only a command that cannot be carried out fails, and then with nothing started.
   */
  const sendControl = (
    command: OrchestrationV2ServerCommand,
  ): Effect.Effect<KodoLoopSendOutcome, Orchestrator.OrchestratorV2Error> | undefined => {
    const decided = messageControl(command);
    if (decided === undefined) return undefined;
    const answered = (note: string) => (dispatch: Orchestrator.OrchestratorV2DispatchResult) =>
      ({ note, dispatch }) satisfies KodoLoopSendOutcome;
    switch (decided.kind) {
      case "refusal":
        return Effect.fail(refuse(command.commandId, command.type, decided.message));
      case "info":
        return decided.read.pipe(
          Effect.map((note): KodoLoopSendOutcome => ({ note, dispatch: undefined })),
        );
      case "run":
        return decided.run.pipe(Effect.map(answered(decided.note)));
      // Stopping nothing is not a failure to the sender; it is told there is nothing running.
      case "stop":
        return decided.running.pipe(
          Effect.flatMap(
            (running): Effect.Effect<KodoLoopSendOutcome, Orchestrator.OrchestratorV2Error> =>
              running
                ? decided.run.pipe(Effect.map(answered(decided.note)))
                : Effect.succeed({
                    note: "No loop is running on this thread.",
                    dispatch: undefined,
                  }),
          ),
        );
    }
  };

  return {
    start,
    stop,
    approve,
    retryJudge,
    extend,
    status,
    intercept,
    sendControl,
  };
};

export type KodoLoopService = ReturnType<typeof makeKodoLoopService>;

/**
 * `sendToThread` for senders that can say what a `/loop` command did (an agent's send, a scheduled
 * task): a loop command answers with its outcome in words instead of failing.
 */
export const sendToThreadOrLoop = <
  R extends { readonly delivery: string },
  E extends { readonly _tag: string },
>(
  sendToThread: Effect.Effect<R, E>,
) =>
  sendToThread.pipe(
    Effect.catch(
      (error): Effect.Effect<R | { readonly delivery: "loop"; readonly note: string }, E> => {
        const cause = (error as { readonly cause?: unknown }).cause;
        return cause instanceof KodoLoopSendNote
          ? Effect.succeed({ delivery: "loop" as const, note: cause.note })
          : Effect.fail(error);
      },
    ),
  );
