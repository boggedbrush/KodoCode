// Whether a provider can lead sub-agents: whether the orchestration tools are really put in front of
// its agent. Every adapter reads the thread's MCP session (prepareMcpSession), so the answer follows
// the driver. The adapters' `tools.supportsMcpTools` flag is declared, never read, and wrong for
// OpenCode, so it is not used.
import type { KodoSubAgentsSupport, ServerProvider } from "@t3tools/contracts";

import { ENFORCEMENT_BY_DRIVER } from "../interactionMode.ts";

const FULL: KodoSubAgentsSupport = { support: "full" };

/** The agent, not T3, decides whether it mounts a tool server; that is known only once a session opens. */
const ACP_AGENT: KodoSubAgentsSupport = {
  support: "full",
  note: "This agent is given the delegation tools over MCP. Whether it uses them is only known once it runs.",
};

/**
 * One entry per driver with a read-only enforcement entry (a test keeps them in step). The ACP-family
 * drivers all run the shared ACP adapter, which passes the T3 tool server in `mcpServers`.
 */
export const KODO_SUB_AGENTS_SUPPORT_BY_DRIVER: Readonly<Record<string, KodoSubAgentsSupport>> = {
  claudeAgent: FULL,
  codex: FULL,
  cursor: FULL,
  opencode: FULL,
  pi: FULL,
  muse: FULL,
  acp: ACP_AGENT,
  acpRegistry: ACP_AGENT,
  grok: ACP_AGENT,
  kiro: ACP_AGENT,
  fx: ACP_AGENT,
  antigravity: ACP_AGENT,
};

export interface KodoNativeSubagents {
  /** The provider's own subagent or task tool is turned off for a thread that leads. */
  readonly withheld: boolean;
  readonly note: string;
}

const INSTRUCTION_ONLY: KodoNativeSubagents = {
  withheld: false,
  note: "Not withheld, instruction-only: this provider has no per-turn switch for its own subagent tool, so the lead's instructions are the only guard.",
};

/**
 * What a lead's provider does about its own subagent or task tool, which would let the lead pick a
 * model and run outside the worker caps. One entry per driver (a test keeps them in step). The
 * policy field `modeBlocksNativeSubagents` is read by the adapters that can act on it.
 */
export const KODO_NATIVE_SUBAGENTS_BY_DRIVER: Readonly<Record<string, KodoNativeSubagents>> = {
  claudeAgent: { withheld: true, note: "The Agent and Task tools are disallowed for the turn." },
  opencode: { withheld: true, note: "The task permission is denied for the session." },
  codex: INSTRUCTION_ONLY,
  cursor: INSTRUCTION_ONLY,
  pi: INSTRUCTION_ONLY,
  muse: INSTRUCTION_ONLY,
  acp: INSTRUCTION_ONLY,
  acpRegistry: INSTRUCTION_ONLY,
  grok: INSTRUCTION_ONLY,
  kiro: INSTRUCTION_ONLY,
  fx: INSTRUCTION_ONLY,
  antigravity: INSTRUCTION_ONLY,
};

/** A server's drivers that read-only enforcement knows and the native-subagent table does not. */
export const kodoDriversMissingNativeSubagents = (): ReadonlyArray<string> =>
  Object.keys(ENFORCEMENT_BY_DRIVER).filter(
    (driver) => KODO_NATIVE_SUBAGENTS_BY_DRIVER[driver] === undefined,
  );

const KODO_SUB_AGENTS_UNKNOWN_DRIVER: KodoSubAgentsSupport = {
  support: "none",
  reason:
    "This provider is not known to receive the delegation tools, so sub-agents would do nothing.",
};

export const kodoSubAgentsSupportForDriver = (driver: string): KodoSubAgentsSupport =>
  KODO_SUB_AGENTS_SUPPORT_BY_DRIVER[driver] ?? KODO_SUB_AGENTS_UNKNOWN_DRIVER;

/** `provider` with the support value of its driver, for the status clients already read. */
export const withKodoSubAgents = <Provider extends Pick<ServerProvider, "driver">>(
  provider: Provider,
): Provider & { readonly kodoSubAgents: KodoSubAgentsSupport } => ({
  ...provider,
  kodoSubAgents: kodoSubAgentsSupportForDriver(provider.driver),
});

/** A server's drivers that read-only enforcement knows and this table does not. */
export const kodoDriversMissingSubAgentsSupport = (): ReadonlyArray<string> =>
  Object.keys(ENFORCEMENT_BY_DRIVER).filter(
    (driver) => KODO_SUB_AGENTS_SUPPORT_BY_DRIVER[driver] === undefined,
  );

/**
 * Why a thread on this provider instance cannot lead, or undefined when it can. `externalOpenCode`
 * is the one instance-level case the driver table cannot see: an OpenCode instance pointed at an
 * external server cannot reach this server's tool endpoint.
 */
export function kodoLeadSupportRefusal(input: {
  readonly provider: Pick<ServerProvider, "driver" | "displayName" | "instanceId"> | undefined;
  readonly externalOpenCode?: boolean;
}): string | undefined {
  const { provider } = input;
  if (provider === undefined) {
    return "This thread's provider is not available, so sub-agents cannot be turned on.";
  }
  const support = kodoSubAgentsSupportForDriver(provider.driver);
  if (support.support === "none") return support.reason;
  if (provider.driver === "opencode" && input.externalOpenCode === true) {
    return `${provider.displayName ?? provider.instanceId} uses an external OpenCode server, which cannot reach this server's delegation tools.`;
  }
  return undefined;
}
