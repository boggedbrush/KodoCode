import {
  DEFAULT_KODO_INTERACTION_MODE,
  KODO_INTERACTION_MODES,
  normalizeKodoInteractionMode,
  type KodoInteractionMode,
  type ThreadInteractionMode,
} from "@t3tools/contracts";

export interface KodoInteractionModeOption {
  readonly mode: KodoInteractionMode;
  readonly label: string;
  readonly description: string;
  readonly readOnly: boolean;
}

export const KODO_INTERACTION_MODE_OPTIONS: ReadonlyArray<KodoInteractionModeOption> = [
  {
    mode: "ask",
    label: "Ask",
    description: "Read-only. Ask questions about the code; nothing is changed.",
    readOnly: true,
  },
  {
    mode: "plan",
    label: "Plan",
    description: "Read-only. Produces a plan for you to approve before anything changes.",
    readOnly: true,
  },
  {
    mode: "code",
    label: "Code",
    description: "Implements changes in your workspace.",
    readOnly: false,
  },
  {
    mode: "review",
    label: "Review",
    description: "Read-only review of your working changes.",
    readOnly: true,
  },
] satisfies ReadonlyArray<KodoInteractionModeOption>;

export function kodoInteractionModeOption(mode: KodoInteractionMode): KodoInteractionModeOption {
  return (
    KODO_INTERACTION_MODE_OPTIONS.find((option) => option.mode === mode) ??
    KODO_INTERACTION_MODE_OPTIONS[2]!
  );
}

/** The mode a composer shows: its own pick, else the thread's, else code. Legacy "default" is code. */
export function resolveKodoInteractionMode(input: {
  readonly composerMode?: ThreadInteractionMode | null | undefined;
  readonly threadMode?: ThreadInteractionMode | null | undefined;
}): KodoInteractionMode {
  return normalizeKodoInteractionMode(
    input.composerMode ?? input.threadMode ?? DEFAULT_KODO_INTERACTION_MODE,
  );
}

/**
 * The mode the composer shows. A thread the server holds shows the server's mode, or the change
 * on its way to it; the composer draft's pick only stands in for a thread that does not exist yet.
 */
export function resolveKodoDisplayedMode(input: {
  readonly isServerThread: boolean;
  readonly pendingMode: KodoInteractionMode | null;
  readonly threadMode: ThreadInteractionMode | null | undefined;
  readonly composerMode: ThreadInteractionMode | null | undefined;
}): KodoInteractionMode {
  return input.isServerThread
    ? normalizeKodoInteractionMode(input.pendingMode ?? input.threadMode)
    : resolveKodoInteractionMode({
        composerMode: input.composerMode,
        threadMode: input.threadMode,
      });
}

/**
 * A mode picked while a turn runs applies from the next turn: the server fixes a turn's
 * restrictions when it starts. True while the shown mode differs from the one the running turn
 * recorded (or, for an old run without one, the thread's mode when the client saw it start).
 */
export function kodoModeWaitsForNextTurn(input: {
  readonly activeRunId: string | null;
  readonly runStartedInMode: KodoInteractionMode;
  readonly displayedMode: KodoInteractionMode;
}): boolean {
  return input.activeRunId !== null && input.runStartedInMode !== input.displayedMode;
}

/** The next mode in Ask, Plan, Code, Review order, wrapping around. */
export function cycleKodoInteractionMode(
  mode: KodoInteractionMode,
  direction: 1 | -1 = 1,
): KodoInteractionMode {
  const count = KODO_INTERACTION_MODES.length;
  const index = KODO_INTERACTION_MODES.indexOf(mode);
  return (
    KODO_INTERACTION_MODES[(index + direction + count) % count] ?? DEFAULT_KODO_INTERACTION_MODE
  );
}

/** A persisted draft value that is a known mode (legacy "default" included), else null. */
export function parseStoredInteractionMode(value: unknown): ThreadInteractionMode | null {
  return value === "default" || KODO_INTERACTION_MODES.some((mode) => mode === value)
    ? (value as ThreadInteractionMode)
    : null;
}

export type KodoModeSlashCommand = KodoInteractionMode;

export function isKodoModeSlashCommand(command: string): command is KodoModeSlashCommand {
  return KODO_INTERACTION_MODES.some((mode) => mode === command);
}

export const KODO_MODE_SLASH_COMMAND_ITEMS = KODO_INTERACTION_MODE_OPTIONS.map((option) => ({
  command: option.mode,
  label: `/${option.mode}`,
  description: `Switch to ${option.label} mode. ${option.description}`,
}));

/** `/ask`, `/plan`, `/code` or `/review` alone in the prompt; anything else is a message. */
export function parseKodoModeSlashCommand(prompt: string): KodoInteractionMode | null {
  const match = /^\s*\/(ask|plan|code|review)\s*$/i.exec(prompt);
  return match ? normalizeKodoInteractionMode(match[1]!.toLowerCase()) : null;
}

/**
 * The composer's resting blocks run mode block first, permissions block second, and the width
 * measurement hides trailing blocks first. Says which of them the overflow menu now holds.
 */
export function resolveKodoModeBlockHidden(input: {
  readonly hasPermissionsBlock: boolean;
  readonly measuredHiddenBlockCount: number;
}): boolean {
  const blockCount = input.hasPermissionsBlock ? 2 : 1;
  return input.measuredHiddenBlockCount >= blockCount;
}

/**
 * The mode a queued message will run in, when it differs from the thread's current mode. A
 * queued message keeps the mode it was queued in; runs from before that was recorded show none.
 */
export function kodoQueuedRunModeLabel(input: {
  readonly runMode: ThreadInteractionMode | null | undefined;
  readonly threadMode: ThreadInteractionMode | null | undefined;
}): string | null {
  if (input.runMode === null || input.runMode === undefined) return null;
  const runMode = normalizeKodoInteractionMode(input.runMode);
  if (runMode === normalizeKodoInteractionMode(input.threadMode)) return null;
  return KODO_INTERACTION_MODE_OPTIONS.find((option) => option.mode === runMode)?.label ?? null;
}
