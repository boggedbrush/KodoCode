// Refuses every tool but the Orchestrator's own (kodo/swarm/swarmAllowlist.ts) for the Orchestrator
// thread, by default: a tool added upstream later stays withheld until it is listed. The caller is
// read from its credential's scope; a tool whose failure type cannot carry the refusal has no
// capability on that credential.
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { Tool, Toolkit } from "effect/ai";

import { KODO_ORCHESTRATOR_TOOLS, kodoSwarmToolRefusal } from "../kodo/swarm/swarmAllowlist.ts";
import { McpInvocationContext } from "./McpInvocationContext.ts";

export const guardSwarmTools = <Tools extends Record<string, Tool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>,
  handlers: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => {
      const tool = toolkit.tools[name];
      if (
        tool === undefined ||
        KODO_ORCHESTRATOR_TOOLS.has(name) ||
        tool.failureSchema !== OrchestratorMcpFailure
      ) {
        return [name, handler];
      }
      const run = handler as (params: unknown) => Effect.Effect<unknown, OrchestratorMcpFailure>;
      return [
        name,
        (params: unknown) =>
          Effect.flatMap(McpInvocationContext, (scope) =>
            scope.thread?.kodoSwarm === true
              ? Effect.fail(
                  new OrchestratorMcpFailure({
                    code: "capability_denied",
                    message: kodoSwarmToolRefusal(name),
                  }),
                )
              : run(params),
          ),
      ];
    }),
  );
