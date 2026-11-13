// Whether a provider can lead sub-agents: whether the orchestration tools (delegate_task and the
// rest) are really put in front of its agent. The server gives each session an MCP credential with
// the orchestration capability (ProviderSessionManager.prepareMcpSession) and every adapter below
// reads it, so the answer follows the driver. The adapters' own `tools.supportsMcpTools` flag is not
// used: it is declared, never read, and is wrong for OpenCode.
import type { KodoSubAgentsSupport, ServerProvider } from "@t3tools/contracts";

import { ENFORCEMENT_BY_DRIVER } from "../interactionMode.ts";

const FULL: KodoSubAgentsSupport = { support: "full" };

/** The agent, not T3, decides whether it mounts a tool server; that is known only once a session opens. */
const ACP_AGENT: KodoSubAgentsSupport = {
  support: "full",
  note: "This agent is given the delegation tools over MCP. Whether it uses them is only known once it runs.",
};

/**
 * One entry per driver that has a read-only enforcement entry (a test keeps the two in step).
 * Evidence, by driver: claude, codex, opencode, cursor, pi and muse adapters read the thread's MCP
 * session at session or turn start; acp, acpRegistry, grok, kiro, fx and antigravity all run the
 * shared ACP adapter, which passes the T3 tool server in the session's `mcpServers` (always as a
 * stdio bridge, and over HTTP or ACP where the agent advertises it).
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

export const KODO_SUB_AGENTS_UNKNOWN_DRIVER: KodoSubAgentsSupport = {
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
