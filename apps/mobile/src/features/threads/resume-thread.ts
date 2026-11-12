// KODO: thread-mode-type
import type {
  ResumeThreadQueueInput,
  SetThreadRuntimeModeInput,
  StartThreadTurnInput,
} from "@t3tools/client-runtime/operations";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  MessageId,
  ModelSelection,
  ThreadInteractionMode,
  RunId,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";

type Command<Input, E> = (request: {
  readonly environmentId: EnvironmentId;
  readonly input: Input;
}) => Promise<AtomCommandResult<unknown, E>>;

/** Resolves to the first failed command's result, or the last successful one. */
export async function resumeThread<E>(input: {
  readonly thread: {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly runtimeMode: RuntimeMode;
    readonly interactionMode: ThreadInteractionMode;
  };
  readonly resumableRunId: RunId | null;
  readonly queueHeld: boolean;
  readonly runtimeMode: RuntimeMode;
  readonly modelSelection: ModelSelection | null;
  readonly messageId: MessageId;
  readonly createdAt: string;
  readonly setRuntimeMode: Command<SetThreadRuntimeModeInput, E>;
  readonly startTurn: Command<StartThreadTurnInput, E>;
  readonly resumeQueue: Command<ResumeThreadQueueInput, E>;
}): Promise<AtomCommandResult<unknown, E>> {
  const { thread, runtimeMode, createdAt } = input;
  const environmentId = thread.environmentId;
  // The server holds the queue behind a stopped or usage-limited run until that run is continued.
  if (input.resumableRunId !== null) {
    // A turn on an existing thread runs with the thread's saved modes, not the turn's.
    if (runtimeMode !== thread.runtimeMode) {
      const saved = await input.setRuntimeMode({
        environmentId,
        input: { threadId: thread.id, runtimeMode, createdAt },
      });
      if (saved._tag === "Failure") return saved;
    }
    // KODO: mode-preserve - mobile has no mode picker, so resuming never changes the thread's mode.
    const continued = await input.startTurn({
      environmentId,
      input: {
        creationSource: "mobile",
        threadId: thread.id,
        manualContinuationOfRunId: input.resumableRunId,
        ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
        message: {
          messageId: input.messageId,
          role: "user",
          text: "Continue where you left off.",
          attachments: [],
        },
        runtimeMode,
        interactionMode: thread.interactionMode, // KODO: mode-preserve
        dispatchMode: "start",
      },
    });
    if (continued._tag === "Failure" || !input.queueHeld) return continued;
  }
  return input.resumeQueue({ environmentId, input: { threadId: thread.id } });
}
