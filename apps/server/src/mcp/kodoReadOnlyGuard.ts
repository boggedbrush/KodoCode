// Kodo: refuses in-app MCP tools that are not read-only (`Tool.Readonly`) in Ask, Plan and Review,
// whichever provider called. Only the access kinds with no mode bound of their own are covered;
// `writesThreads` and `writesEnvironment` already bound what they touch.
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { Tool, type Toolkit } from "effect/ai";

import { kodoInteractionModeRank } from "../kodo/interactionMode.ts";

const refusedKinds = new WeakSet<object>();

/** Marks a declaration of a kind that read-only modes refuse (when its tool is not read-only). */
export const refusesInReadOnlyModes = <Declaration extends object>(
  declaration: Declaration,
): Declaration => {
  refusedKinds.add(declaration);
  return declaration;
};

/** Marks `derived` as refused when any of the declarations it is built from is. */
export const refusesWhenAnyRefuses = <Declaration extends object>(
  derived: Declaration,
  from: ReadonlyArray<object>,
): Declaration =>
  from.some((source) => refusedKinds.has(source)) ? refusesInReadOnlyModes(derived) : derived;

/** A tool is read-only only when its declaration says so; an unannotated tool is a writing tool. */
export const isReadOnlyMcpTool = (tool: Tool.Any): boolean =>
  Context.get(tool.annotations, Tool.Readonly) === true;

/** The name of the tool being called, set only while a refused-kind, non-read-only tool runs. */
const RefusedInReadOnlyModes = Context.Reference<string | undefined>(
  "t3/mcp/kodoReadOnlyGuard/RefusedInReadOnlyModes",
  { defaultValue: () => undefined },
);

/**
 * Step for the caller checks that load the caller anyway, so the guard costs no extra read: fails
 * a read-only caller (thread, or client narrowed to a read-only mode) of a refused tool.
 */
export const refuseReadOnlyCaller = (caller: {
  readonly limits: { readonly interactionMode: unknown };
}) =>
  Effect.flatMap(RefusedInReadOnlyModes, (toolName) =>
    toolName !== undefined && kodoInteractionModeRank(caller.limits.interactionMode) === 0
      ? Effect.fail(
          new OrchestratorMcpFailure({
            code: "capability_denied",
            message: `${toolName} changes things, and this thread is in a read-only mode (Ask, Plan or Review). Switch the thread to Code mode to use it.`,
          }),
        )
      : Effect.void,
  );

/**
 * `handlers` with every tool of a refused kind that is not read-only marked, so its caller check
 * (`refuseReadOnlyCaller`) refuses read-only callers. Applied to the finished handler map, so
 * linked-environment forwarding is covered too.
 */
export const guardReadOnlyModes = <Tools extends Record<string, Tool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>,
  handlers: Record<string, unknown>,
  declarations: Record<string, object>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => {
      const tool = toolkit.tools[name];
      const declaration = declarations[name];
      if (
        tool === undefined ||
        declaration === undefined ||
        !refusedKinds.has(declaration) ||
        isReadOnlyMcpTool(tool)
      ) {
        return [name, handler];
      }
      const run = handler as (params: unknown) => Effect.Effect<unknown, OrchestratorMcpFailure>;
      return [
        name,
        (params: unknown) => Effect.provideService(run(params), RefusedInReadOnlyModes, name),
      ];
    }),
  );
