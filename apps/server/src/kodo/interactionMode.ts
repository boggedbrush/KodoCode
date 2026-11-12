// Kodo: resolves a thread's mode (ask/plan/code/review) into what adapters get. Adapters only ever
// see upstream's "default" | "plan" wire mode; the read-only modes (ask, plan, review) use the
// strongest mechanism per driver (see ENFORCEMENT_BY_DRIVER) plus instruction text.
import {
  isRuntimeModeAbove,
  normalizeKodoInteractionMode,
  type KodoInteractionMode,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";

/**
 * How a driver enforces read-only, strongest mechanism first: claude: tool list and denied edits;
 * codex: readOnly sandbox; acp-family, opencode: auto-denying policy; cursor: native plan mode;
 * launch (pi, muse): write and shell tools removed at launch; ceiling: approval ceiling plus text.
 */
type ReadOnlyEnforcement =
  | "claude"
  | "codex"
  | "acp-family"
  | "opencode"
  | "cursor"
  | "launch"
  | "ceiling";

/**
 * Where a driver applies its permission level. "turn": the adapter re-applies the whole policy on
 * every turn (read from its code), so a live session can serve a run with another policy. "session":
 * some part is fixed when the session or its process opens, so a session opened under another policy
 * must be reopened (`kodoSessionNeedsRestart`).
 */
type PolicyScope = "turn" | "session";

interface DriverEnforcement {
  readonly enforcement: ReadOnlyEnforcement;
  /** Whether wire "plan" selects a provider plan mode that captures plans. */
  readonly nativePlan: boolean;
  readonly policyScope: PolicyScope;
}

/**
 * Every built-in provider driver needs an entry (a server test enumerates BUILT_IN_DRIVERS); a
 * driver without one fails closed to the weakest mechanism and a session restart on every policy
 * change.
 */
export const ENFORCEMENT_BY_DRIVER: Readonly<Record<string, DriverEnforcement>> = {
  // Per turn: the query is rebuilt when its policy key changes (a continuation keeps the live query
  // only when that is no more permissive, see ClaudeAdapterV2.openQuery).
  claudeAgent: { enforcement: "claude", nativePlan: true, policyScope: "turn" },
  // Per turn: turn/start carries sandbox, approval policy and collaboration mode.
  codex: { enforcement: "codex", nativePlan: true, policyScope: "turn" },
  // Sandbox and auto-review are set when the session opens.
  cursor: { enforcement: "cursor", nativePlan: true, policyScope: "session" },
  // Per turn: v1 reapplies permission rules and v2 rewrites session rules and agent on every turn.
  opencode: { enforcement: "opencode", nativePlan: true, policyScope: "turn" },
  // Generic ACP agents: their own permission knobs are unknown, so only a reopen resets them.
  acp: { enforcement: "acp-family", nativePlan: true, policyScope: "session" },
  acpRegistry: { enforcement: "acp-family", nativePlan: true, policyScope: "session" },
  // Grok has a native plan mode of its own (exit_plan_mode); its runtime mode is a launch option.
  grok: { enforcement: "acp-family", nativePlan: true, policyScope: "session" },
  // Kiro's autopilot and fx's session mode are protocol calls the shared ACP adapter repeats when
  // the policy changes, but both reopen on a runtime-mode change today, so they stay per session.
  kiro: { enforcement: "acp-family", nativePlan: false, policyScope: "session" },
  fx: { enforcement: "acp-family", nativePlan: false, policyScope: "session" },
  // Per turn: the shared ACP adapter sets the session mode (yolo or default) whenever it changes.
  antigravity: { enforcement: "acp-family", nativePlan: false, policyScope: "turn" },
  // Pi's extension environment and tool list, and Muse's host flags, are fixed at launch.
  pi: { enforcement: "launch", nativePlan: false, policyScope: "session" },
  muse: { enforcement: "launch", nativePlan: false, policyScope: "session" },
};

/** An unresolved or unknown driver fails closed: the ceiling plus instructions, like a driver with no plan mode. */
const UNKNOWN_DRIVER: DriverEnforcement = {
  enforcement: "ceiling",
  nativePlan: false,
  policyScope: "session",
};

const READ_ONLY_RUNTIME_CEILING: RuntimeMode = "approval-required";
const READ_ONLY_SANDBOX = { type: "readOnly" } as const;

const enforcementFor = (driver: string | undefined): DriverEnforcement =>
  (driver === undefined ? undefined : ENFORCEMENT_BY_DRIVER[driver]) ?? UNKNOWN_DRIVER;

const MODE_MARKER_NOTE =
  "This mode stays in force for the whole thread, including later messages that do not repeat this block, until a message carries a different kodo_interaction_mode block.";

export const KODO_ASK_MODE_INSTRUCTIONS = `<kodo_interaction_mode mode="ask">
# Ask mode (read-only)

You are in Ask mode. You must not modify files, and you must not run commands that change the working tree, the index, git history, installed dependencies or any state outside this conversation.

Your job is to answer the user's questions about this codebase. Read files, search, and run read-only commands (listing, grepping, \`git log\`, \`git diff\`, \`git show\`) as needed to ground your answer in the actual code.

Rules:
- Answer the question directly and concisely. Cite the files and symbols you relied on.
- Say so when you are unsure or when the answer depends on code you could not find; do not guess.
- Do not write an implementation plan or ask to leave a plan or approval flow unless the user asks for one.
- If the user asks for a change, explain how it could be made and tell them to switch to Code mode to apply it.

${MODE_MARKER_NOTE}
</kodo_interaction_mode>`;

export const KODO_REVIEW_MODE_INSTRUCTIONS = `<kodo_interaction_mode mode="review">
# Review mode (read-only)

You are in Review mode. You must not modify files, and you must not run commands that change the working tree, the index, git history, installed dependencies or any state outside this conversation.

Your job is to review the working changes as a senior code reviewer. Unless the user supplied a diff or named a different target, inspect them yourself with read-only git commands (\`git status\`, \`git diff\`, \`git diff --staged\`) and read the surrounding code.

Prioritize:
1. correctness bugs
2. regressions
3. edge cases
4. security or privacy risks
5. data-loss risks
6. performance issues caused by the change
7. mismatches between likely intent and actual implementation

Rules:
- Be concise.
- Prefer high-signal findings only.
- Do not comment on style unless it affects correctness or maintainability.
- Ground every finding in the supplied diff or visible repo state.
- Ask clarifying questions if missing context blocks a reliable conclusion.
- If useful, say in a sentence or two how a finding could be fixed, inside the review itself. Do not produce a separate implementation plan or use a plan tool.
- Do not rewrite code unless explicitly asked to implement fixes.
- Write a short summary in prose first, with any open questions. Then end your reply with exactly one fenced block labelled \`kodo-review\`, holding JSON. It must be the very last thing in the reply: no text after it, and no other \`kodo-review\` block anywhere (quote an example in a longer fence or describe it instead). A block that is not last, or a second one, is ignored. If the request asks for a different result format, follow the request instead.

\`\`\`kodo-review
{"version":1,"verdict":"concerns","summary":"One or two sentences.","findings":[{"id":"f1","severity":"medium","title":"Short name of the problem","file":"src/example.ts","line":42,"detail":"What is wrong and why it matters.","fix":"How to fix it, in a sentence or two."}]}
\`\`\`

- \`verdict\` is \`pass\`, \`concerns\` or \`blocking\`. \`blocking\` needs at least one \`high\` finding. \`pass\` lists no \`high\` finding, and no findings at all when the change is clean (\`"findings":[]\`). \`concerns\` lists at least one finding.
- \`severity\` is \`high\`, \`medium\` or \`low\`. Give each finding a unique \`id\`. \`file\` (a path) and \`line\` (a number from 1) are optional; leave them out when a finding is not tied to one line. \`fix\` is optional.
- Keep \`summary\` under 600 characters, each \`detail\` and \`fix\` under 2000, and list at most 30 findings, most serious first.
- The block must be valid JSON: double quotes, no comments, no trailing commas.

${MODE_MARKER_NOTE}
</kodo_interaction_mode>`;

export const KODO_PLAN_MODE_INSTRUCTIONS = `<kodo_interaction_mode mode="plan">
# Plan mode (read-only)

You are in Plan mode. You must not modify files, and you must not run commands that change the working tree, the index, git history, installed dependencies or any state outside this conversation.

Your job is to investigate with read-only actions and then present an implementation plan to the user. Do not start implementing it.

Rules:
- Resolve what you can by reading the code before asking the user a question.
- Ask a concise question only when a missing decision would materially change the plan.
- Finish with the plan itself in your reply: the goal, the files and symbols involved, the ordered steps, and the risks or open questions.
- The user will accept the plan or give feedback in a later request.

${MODE_MARKER_NOTE}
</kodo_interaction_mode>`;

export const KODO_CODE_MODE_INSTRUCTIONS = `<kodo_interaction_mode mode="code">
# Code mode

You are now in Code mode. Any Ask, Plan or Review restriction from earlier in this conversation no longer applies: you may modify files and run commands to carry out the user's request, within the tool approvals the user has granted.

This mode stays in force for the whole thread until a message carries a different kodo_interaction_mode block.
</kodo_interaction_mode>`;

export interface KodoInteractionModeResolution {
  /** The normalized Kodo mode. */
  readonly mode: KodoInteractionMode;
  /** The only interaction mode value provider adapters ever receive. */
  readonly wireInteractionMode: ProviderInteractionMode;
  /** Text to deliver with the turn. Undefined for code, and for plan where the provider has a native plan mode. */
  readonly instructions: string | undefined;
  /** Upper bound on the runtime mode for this mode and provider; undefined means no extra bound. */
  readonly runtimeModeCeiling: RuntimeMode | undefined;
  /** Codex-shaped sandbox policy override. Providers that read it deny edits automatically. */
  readonly sandboxPolicy: { readonly type: "readOnly" } | undefined;
  /** "never" turns what would be an approval prompt into an automatic denial. */
  readonly approvalPolicy: "never" | undefined;
  /** True for every mode but code. */
  readonly readOnly: boolean;
  /** True where the wire mode is the provider's plan mode but the Kodo mode is not Plan. */
  readonly suppressPlanCapture: boolean;
}

const CODE_RESOLUTION = {
  wireInteractionMode: "default",
  instructions: undefined,
  runtimeModeCeiling: undefined,
  sandboxPolicy: undefined,
  approvalPolicy: undefined,
  readOnly: false,
  suppressPlanCapture: false,
} as const;

/**
 * Resolves a thread's stored mode for a provider driver. Total: legacy `"default"` and unknown
 * values resolve as code. `driver` is the provider driver kind; an undefined or unknown driver
 * fails closed, resolving like a driver with no native plan mode.
 */
export function resolveKodoInteractionMode(input: {
  readonly mode: unknown;
  readonly driver: string | undefined;
}): KodoInteractionModeResolution {
  const mode = normalizeKodoInteractionMode(input.mode);
  if (mode === "code") return { mode, ...CODE_RESOLUTION };
  const { enforcement, nativePlan } = enforcementFor(input.driver);
  const text =
    mode === "ask"
      ? KODO_ASK_MODE_INSTRUCTIONS
      : mode === "review"
        ? KODO_REVIEW_MODE_INSTRUCTIONS
        : KODO_PLAN_MODE_INSTRUCTIONS;
  const resolved = (
    fields: Pick<
      KodoInteractionModeResolution,
      "wireInteractionMode" | "sandboxPolicy" | "approvalPolicy"
    >,
  ): KodoInteractionModeResolution => ({
    mode,
    ...fields,
    // Upstream's plan prompt and proposed-plan capture exist wherever the wire mode is "plan", so
    // Plan adds no text there; every other mode needs the text.
    instructions: mode === "plan" && fields.wireInteractionMode === "plan" ? undefined : text,
    runtimeModeCeiling: READ_ONLY_RUNTIME_CEILING,
    readOnly: true,
    suppressPlanCapture: fields.wireInteractionMode === "plan" && mode !== "plan",
  });
  // Plan keeps the provider's plan mode where there is one; ask and review use it only where the
  // provider has nothing stronger (cursor).
  const planWire = (wantsPlanWire: boolean) =>
    nativePlan && wantsPlanWire ? ("plan" as const) : ("default" as const);
  // Ask and Plan deny shell as well as edits; Review leaves shell on approval (approvalPolicy unset).
  const hardDeny = mode === "review" ? undefined : ("never" as const);
  switch (enforcement) {
    case "claude":
      return mode === "plan"
        ? resolved({
            wireInteractionMode: "plan",
            sandboxPolicy: undefined,
            approvalPolicy: "never",
          })
        : mode === "ask"
          ? resolved({
              wireInteractionMode: "default",
              sandboxPolicy: READ_ONLY_SANDBOX,
              approvalPolicy: "never",
            })
          : resolved({
              wireInteractionMode: "default",
              sandboxPolicy: undefined,
              approvalPolicy: undefined,
            });
    case "codex":
      return resolved({
        wireInteractionMode: planWire(mode === "plan"),
        sandboxPolicy: READ_ONLY_SANDBOX,
        approvalPolicy: "never",
      });
    case "acp-family":
    case "opencode":
      return resolved({
        wireInteractionMode: planWire(mode === "plan"),
        sandboxPolicy: READ_ONLY_SANDBOX,
        approvalPolicy: hardDeny,
      });
    case "cursor":
      return resolved({
        wireInteractionMode: "plan",
        sandboxPolicy: undefined,
        approvalPolicy: undefined,
      });
    case "launch":
      // The host is launched without write tools (and, in Ask and Plan, without shell); the
      // approval policy tells the adapter which. Review keeps shell on approval.
      return resolved({
        wireInteractionMode: "default",
        sandboxPolicy: undefined,
        approvalPolicy: hardDeny,
      });
    case "ceiling":
      return resolved({
        wireInteractionMode: "default",
        sandboxPolicy: undefined,
        approvalPolicy: undefined,
      });
  }
}

const capRuntimeMode = (runtimeMode: RuntimeMode, ceiling: RuntimeMode | undefined): RuntimeMode =>
  ceiling !== undefined && isRuntimeModeAbove(runtimeMode, ceiling) ? ceiling : runtimeMode;

/** The runtime mode a turn really runs with: the thread's, capped by the mode's ceiling. */
export function kodoEffectiveRuntimeMode(input: {
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: unknown;
  readonly driver: string | undefined;
}): RuntimeMode {
  return capRuntimeMode(
    input.runtimeMode,
    resolveKodoInteractionMode({ mode: input.interactionMode, driver: input.driver })
      .runtimeModeCeiling,
  );
}

/**
 * Runtime-policy fields a Kodo mode contributes, to spread over the upstream policy
 * (`{ ...basePolicy, ...kodoRuntimePolicyOverlay(...) }`).
 */
export function kodoRuntimePolicyOverlay(input: {
  readonly interactionMode: unknown;
  readonly driver: string | undefined;
  readonly runtimeMode: RuntimeMode;
}): {
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly sandboxPolicy?: { readonly type: "readOnly" };
  readonly approvalPolicy?: "never";
  readonly modeInstructions?: string;
  readonly modeReadOnly?: true;
  readonly modeSuppressesPlanCapture?: true;
} {
  const resolution = resolveKodoInteractionMode({
    mode: input.interactionMode,
    driver: input.driver,
  });
  return {
    runtimeMode: capRuntimeMode(input.runtimeMode, resolution.runtimeModeCeiling),
    interactionMode: resolution.wireInteractionMode,
    ...(resolution.sandboxPolicy === undefined ? {} : { sandboxPolicy: resolution.sandboxPolicy }),
    ...(resolution.approvalPolicy === undefined
      ? {}
      : { approvalPolicy: resolution.approvalPolicy }),
    ...(resolution.instructions === undefined ? {} : { modeInstructions: resolution.instructions }),
    ...(resolution.readOnly ? { modeReadOnly: true as const } : {}),
    ...(resolution.suppressPlanCapture ? { modeSuppressesPlanCapture: true as const } : {}),
  };
}

/** What a thread's mode makes a provider session run with, for comparing two modes. */
const effectivePolicyKey = (input: {
  readonly runtimeMode: RuntimeMode;
  readonly mode: unknown;
  readonly driver: string | undefined;
}): string => {
  const resolution = resolveKodoInteractionMode(input);
  return JSON.stringify([
    capRuntimeMode(input.runtimeMode, resolution.runtimeModeCeiling),
    resolution.wireInteractionMode,
    resolution.sandboxPolicy?.type ?? null,
    resolution.approvalPolicy ?? null,
  ]);
};

/**
 * Whether switching a thread between two modes changes the effective policy (runtime ceiling,
 * sandbox, approval policy or wire mode) a provider session runs with. Sessions that cannot switch
 * in place must then restart. The runtime mode is the thread's own: a mode only lowers it, so a
 * provider that cannot run it still runs at or below the ceiling.
 */
export function kodoInteractionModeChangesEffectivePolicy(input: {
  readonly runtimeMode: RuntimeMode;
  readonly from: unknown;
  readonly to: unknown;
  readonly driver: string | undefined;
}): boolean {
  return (
    effectivePolicyKey({ ...input, mode: input.from }) !==
    effectivePolicyKey({ ...input, mode: input.to })
  );
}

export const KODO_MODE_DETACH_REASON = "Interaction mode changed.";

/** The provider sessions a mode switch must detach, which cannot take the new policy in place. */
export function kodoModeSwitchDetachSessionIds(input: {
  readonly runtimeMode: RuntimeMode;
  readonly from: unknown;
  readonly to: unknown;
  readonly sessions: ReadonlyArray<{
    readonly id: string;
    readonly driver: string;
    readonly capabilities: {
      readonly sessions: { readonly supportsRuntimeModeSwitchInSession: boolean };
    };
  }>;
}): ReadonlyArray<string> {
  return input.sessions
    .filter(
      (session) =>
        !session.capabilities.sessions.supportsRuntimeModeSwitchInSession &&
        kodoInteractionModeChangesEffectivePolicy({
          runtimeMode: input.runtimeMode,
          from: input.from,
          to: input.to,
          driver: session.driver,
        }),
    )
    .map((session) => session.id);
}

/** The permission-relevant part of a resolved runtime policy, as a comparable key. */
export function kodoSessionPolicyKey(policy: {
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly sandboxPolicy?: unknown;
  readonly approvalPolicy?: unknown;
  readonly modeReadOnly?: boolean | undefined;
  readonly modeSuppressesPlanCapture?: boolean | undefined;
}): string {
  const sandbox = policy.sandboxPolicy;
  return JSON.stringify([
    policy.runtimeMode,
    policy.interactionMode,
    typeof sandbox === "object" && sandbox !== null && "type" in sandbox ? sandbox.type : null,
    policy.approvalPolicy ?? null,
    policy.modeReadOnly === true,
    policy.modeSuppressesPlanCapture === true,
  ]);
}

/**
 * Whether a live session opened under policy key `opened` must be reopened for a run resolved to
 * `next`. A driver that re-applies its whole policy per turn keeps the session; every other one
 * (and an unknown driver) is reopened, because part of its permission level is fixed at open.
 */
export function kodoSessionNeedsRestart(input: {
  readonly driver: string | undefined;
  readonly opened: string | undefined;
  readonly next: string;
}): boolean {
  if (input.opened === input.next) return false;
  return enforcementFor(input.driver).policyScope !== "turn";
}

/**
 * Puts mode instructions in front of the user's text, for every provider. A `/` message is
 * delivered as typed: native commands must start the prompt and take the rest as arguments. The
 * restriction still holds for it, since the block lasts for the thread and enforcement is not text.
 */
export function withKodoModeInstructions<Message extends { readonly text: string }>(
  message: Message,
  instructions: string | undefined,
): Message {
  if (instructions === undefined || isNativeSlashMessage(message)) return message;
  return { ...message, text: `${instructions}\n\n${message.text}` };
}

const isNativeSlashMessage = (message: { readonly text: string }): boolean =>
  message.text.trimStart().startsWith("/");

const MAX_TRACKED_THREADS = 4096;

/**
 * Remembers the mode each thread's model was last told, so that a switch back to Code is announced
 * and a restriction rides on every message. Memory only: after a restart an existing thread
 * (one with earlier turns) is announced as Code once, which is harmless when it already was.
 */
export function makeKodoModeAnnouncer() {
  const delivered = new Map<string, KodoInteractionMode>();
  const remember = (threadId: string, mode: KodoInteractionMode) => {
    delivered.delete(threadId);
    delivered.set(threadId, mode);
    for (const oldest of delivered.keys()) {
      if (delivered.size <= MAX_TRACKED_THREADS) break;
      delivered.delete(oldest);
    }
  };
  return {
    /**
     * `message` with the instruction block its thread's model needs, if any: the mode's block for
     * a read-only mode, the Code block when the model was last told a restriction (or the thread
     * has earlier turns this process never saw). Slash messages pass through and change nothing.
     */
    apply<Message extends { readonly text: string }>(
      message: Message,
      input: {
        readonly threadId: string;
        /** The thread's mode, and the instructions its resolved policy carries (none for code). */
        readonly mode: unknown;
        readonly instructions: string | undefined;
        readonly hasPriorTurns: boolean;
      },
    ): Message {
      if (isNativeSlashMessage(message)) return message;
      const mode = normalizeKodoInteractionMode(input.mode);
      const last = delivered.get(input.threadId);
      const instructions =
        mode !== "code"
          ? input.instructions
          : last === undefined
            ? input.hasPriorTurns
              ? KODO_CODE_MODE_INSTRUCTIONS
              : undefined
            : last !== "code"
              ? KODO_CODE_MODE_INSTRUCTIONS
              : undefined;
      remember(input.threadId, mode);
      return withKodoModeInstructions(message, instructions);
    },
    forget: (threadId: string) => {
      delivered.delete(threadId);
    },
  };
}

/** The field a new run records: the mode its thread had when the run was created. */
export const kodoRunModeSnapshot = (threadMode: unknown) => ({
  interactionMode: normalizeKodoInteractionMode(threadMode),
});

/**
 * How much a mode holds an agent back, for choosing between two modes. Ask is the most restrictive
 * (no shell, no plan flow); Plan is read-only with shell denied wherever the provider can deny it;
 * Review keeps shell on approval for the providers that cannot tell read-only shell from the
 * rest; Code restricts nothing.
 */
const MODE_RESTRICTION = { ask: 3, plan: 2, review: 1, code: 0 } as const;

export const kodoInteractionModeRestriction = (mode: unknown): number =>
  MODE_RESTRICTION[normalizeKodoInteractionMode(mode)];

/** The more restrictive of two modes; the first on a tie. */
export function kodoMoreRestrictiveMode(left: unknown, right: unknown): KodoInteractionMode {
  const a = normalizeKodoInteractionMode(left);
  const b = normalizeKodoInteractionMode(right);
  return MODE_RESTRICTION[b] > MODE_RESTRICTION[a] ? b : a;
}

/**
 * The mode a run starts with: the more restrictive of the mode it was created in and its thread's
 * current mode. A run created in a read-only mode stays read-only after the thread moves to Code;
 * a run created in Code on a thread since moved to a read-only mode runs read-only; a run created
 * in Review on a thread now in Ask runs as Ask; a run with no snapshot takes the thread's mode.
 */
export function kodoEffectiveRunMode(runMode: unknown, threadMode: unknown): KodoInteractionMode {
  return runMode === undefined
    ? normalizeKodoInteractionMode(threadMode)
    : kodoMoreRestrictiveMode(runMode, threadMode);
}

/**
 * Whether a message sent now may be steered into a running turn: only when the run was created in
 * the thread's current mode, since a steer runs with the policy the turn started with (a read-only
 * message must not get a Code turn's write access, nor a Code message a read-only turn). Otherwise
 * it queues as its own run.
 */
export function kodoMaySteerIntoRun(runMode: unknown, threadMode: unknown): boolean {
  return (
    runMode === undefined ||
    normalizeKodoInteractionMode(runMode) === normalizeKodoInteractionMode(threadMode)
  );
}

/** The process-wide announcer: turn starts and steers of one thread must share what it was told. */
export const kodoModeAnnouncer = makeKodoModeAnnouncer();

/**
 * `text` for a message steered into a running turn, with the thread's current mode block: a steer
 * is a message like any other, so the restriction (or the move back to Code) reaches it too.
 */
export function kodoSteerText(
  text: string,
  input: { readonly threadId: string; readonly mode: unknown; readonly driver: string | undefined },
): string {
  return kodoModeAnnouncer.apply(
    { text },
    {
      threadId: input.threadId,
      mode: input.mode,
      instructions: resolveKodoInteractionMode(input).instructions,
      // The turn being steered announced the mode when it started; a steer never opens a cold thread.
      hasPriorTurns: false,
    },
  ).text;
}

/**
 * How much a mode lets an agent do, for the rule that a delegate may not run with more authority
 * than its parent. Code is the only mode that writes.
 */
export function kodoInteractionModeRank(mode: unknown): number {
  return normalizeKodoInteractionMode(mode) === "code" ? 1 : 0;
}

/**
 * The narrow upstream mode that bounds a Kodo mode, for boundaries that only carry upstream's
 * `"default" | "plan"` (peer environments, scheduled tasks): every non-writing mode is "plan".
 */
export function kodoInteractionModeLimit(mode: unknown): ProviderInteractionMode {
  return kodoInteractionModeRank(mode) === 0 ? "plan" : "default";
}
