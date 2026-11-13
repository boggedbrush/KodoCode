// What the Orchestrator's tool door says (the door itself, `withSwarmAllowlist`, is in McpHttpServer.ts):
// every tool but its own (kodo/swarm/swarmAllowlist.ts) is refused by name, whatever its failure type,
// before its arguments are read.
import { OrchestratorMcpFailure, isKodoOrchestratorThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema } from "effect/ai";

import { kodoSwarmToolRefusal } from "../kodo/swarm/swarmAllowlist.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";

const encodeFailure = Schema.encodeSync(OrchestratorMcpFailure);

/** The marked flag, or the fixed id the Orchestrator's thread has: either one is enough. */
export const isSwarmScope = (scope: McpInvocationScope | undefined): boolean =>
  scope?.thread !== undefined &&
  (scope.thread.kodoSwarm === true || isKodoOrchestratorThreadId(scope.thread.threadId));

/** The refusal as every tool of this server reports a returned failure. */
export const swarmToolRefusalResult = (toolName: string): McpSchema.CallToolResult => {
  const failure = encodeFailure(
    new OrchestratorMcpFailure({
      code: "capability_denied",
      message: kodoSwarmToolRefusal(toolName),
    }),
  );
  return new McpSchema.CallToolResult({
    isError: true,
    structuredContent: failure,
    content: [{ type: "text", text: JSON.stringify(failure) }],
  });
};
