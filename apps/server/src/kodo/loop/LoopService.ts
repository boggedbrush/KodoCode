// The loop's control surface: start, stop, approve, extend, retry the judge and read the status.
// The `/loop` message intercept, the WebSocket handlers and (later) an agent tool all call these
// instead of building commands themselves, so the rules (defaults from settings, one loop per
// thread, nothing starts over a running turn) are decided in one place. The orchestrator enforces
// the same rules under the thread's lock; the checks here only give the person a clear message.
import {
  CommandId,
  DEFAULT_KODO_LOOP_SETTINGS,
  type KodoLoop,
  type KodoLoopBudget,
  type KodoLoopControl,
  type MessageId,
  type OrchestrationV2Command,
  type OrchestrationV2ServerCommand,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import { OrchestratorDispatchError } from "../../orchestration-v2/Orchestrator.ts";
import type * as ServerSettings from "../../serverSettings.ts";
import { parseLoopCommand } from "./loopCommand.ts";
import { isKodoLoopTerminal } from "./loopState.ts";

type MessageDispatchCommand = Extract<
  OrchestrationV2Command,
  { readonly type: "message.dispatch" }
>;

export interface KodoLoopServiceDeps {
  readonly orchestrator: Pick<Orchestrator.OrchestratorV2["Service"], "dispatch" | "getThreadRecords">;
  readonly serverSettings: Pick<ServerSettings.ServerSettingsService["Service"], "getSettings">;
}

/** One line saying where a loop stands, for `/loop status` and for the person reading a stop. */
export function describeKodoLoop(loop: KodoLoop): string {
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

/** Messages that are not a person (or an agent) typing `/loop`: continuations, wakes and notices. */
const isControlText = (command: MessageDispatchCommand) =>
  command.kodoLoopStage === undefined &&
  command.notification === undefined &&
  command.guestMessageId === undefined &&
  command.delegatedCompletion === undefined &&
  command.idleCompaction === undefined &&
  command.restartContinuationOfRunId === undefined &&
  command.usageLimitContinuationOfRunId === undefined &&
  command.manualContinuationOfRunId === undefined;

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

  /**
   * The dispatch a `/loop` message stands for, or undefined when the message is anything else. The
   * message itself is not sent as a turn: the loop's stage messages carry the request on.
   */
  const intercept = (command: OrchestrationV2ServerCommand) => {
    if (command.type !== "message.dispatch" || !isControlText(command)) return undefined;
    const parsed = parseLoopCommand(command.text);
    if (parsed === null) return undefined;
    const { threadId, commandId } = command;
    const fail = (message: string) =>
      Effect.fail(refuse(commandId, command.type, message));
    switch (parsed.type) {
      case "invalid":
        return fail(parsed.message);
      case "status":
        // No turn is sent for a status, so the answer travels as the message's refusal.
        return status(threadId).pipe(Effect.flatMap(fail));
      case "stop":
        return stop({ threadId, commandId });
      case "start":
        return command.attachments.length > 0
          ? fail("A loop takes text only; send it again without attachments.")
          : start({
              threadId,
              commandId,
              requestMessageId: command.messageId,
              request: parsed.request,
              maxRounds: parsed.maxRounds,
            });
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
  };
};

export type KodoLoopService = ReturnType<typeof makeKodoLoopService>;
