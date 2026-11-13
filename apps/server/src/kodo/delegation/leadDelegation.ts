// What a lead's delegation call becomes before the upstream rules see it. A lead never picks a
// worker's model, provider or effort: the worker's mode slot (Settings, Models by mode) decides, and
// nothing is recorded as an explicit pick. A role the lead names maps to a mode, clamped to what the
// lead's own mode may start; the child-mode and runtime-mode limits still run after this and are what
// actually forbid escalation.
import {
  normalizeKodoInteractionMode,
  type KodoInteractionMode,
  type KodoModeModels,
  type OrchestratorMcpTarget,
  type OrchestratorMcpTaskRole,
  type ThreadInteractionMode,
} from "@t3tools/contracts";

import { kodoModeModelSlot } from "@t3tools/shared/kodoModeModel";

import { kodoInteractionModeRank, kodoInteractionModeRestriction } from "../interactionMode.ts";

const ROLE_MODE: Readonly<Record<OrchestratorMcpTaskRole, KodoInteractionMode | undefined>> = {
  implementation: "code",
  test: "code",
  review: "review",
  research: "ask",
  design: "plan",
  general: undefined,
};

/** Whether a thread in `lead` mode may start a child in `child` mode: never broader, never less restrictive. */
export const kodoLeadMayStartMode = (lead: unknown, child: unknown): boolean =>
  kodoInteractionModeRank(child) <= kodoInteractionModeRank(lead) &&
  kodoInteractionModeRestriction(child) >= kodoInteractionModeRestriction(lead);

/**
 * The mode a lead's worker is asked to run in. An explicit mode is the lead's own choice and passes
 * through unchanged, so the upstream limit refuses an escalation loudly. A mode taken from a role is
 * only a default: where the lead's mode cannot start it (a Plan lead naming an implementation role)
 * it clamps to the lead's own mode, so a read-only thread only ever gets read-only workers.
 */
export function kodoLeadWorkerMode(input: {
  readonly leadMode: unknown;
  readonly role: OrchestratorMcpTaskRole | undefined;
  readonly requested: ThreadInteractionMode | "inherit" | undefined;
}): ThreadInteractionMode | "inherit" {
  if (input.requested !== undefined && input.requested !== "inherit") return input.requested;
  const mapped = input.role === undefined ? undefined : ROLE_MODE[input.role];
  if (mapped === undefined) return "inherit";
  return kodoLeadMayStartMode(input.leadMode, mapped)
    ? mapped
    : normalizeKodoInteractionMode(input.leadMode);
}

/** A target without anything that names a model: only where the worker runs survives. */
export function kodoLeadWorkerTarget(
  target: OrchestratorMcpTarget | undefined,
): OrchestratorMcpTarget | undefined {
  if (target === undefined) return undefined;
  const { environmentId, projectId } = target;
  if (environmentId === undefined && projectId === undefined) return undefined;
  return {
    ...(environmentId === undefined ? {} : { environmentId }),
    ...(projectId === undefined ? {} : { projectId }),
  };
}

interface LeadDelegationInput {
  readonly target?: OrchestratorMcpTarget | undefined;
  readonly role?: OrchestratorMcpTaskRole | undefined;
  readonly interactionMode?: ThreadInteractionMode | "inherit" | undefined;
}

/** A delegation call from a lead: the target stripped, the role turned into a mode. */
export function normalizeLeadDelegation<Input extends LeadDelegationInput>(
  input: Input,
  leadMode: unknown,
): Input {
  const { target: _named, ...rest } = input;
  const target = kodoLeadWorkerTarget(input.target);
  return {
    ...rest,
    ...(target === undefined ? {} : { target }),
    interactionMode: kodoLeadWorkerMode({
      leadMode,
      role: input.role,
      requested: input.interactionMode,
    }),
  } as unknown as Input;
}

/**
 * The provider instances a worker started in `mode` may really run on: the mode slot's, and the
 * inherited one it falls back to when the slot cannot run. The usage gate reads every one of them,
 * because which of the two runs is decided later, at dispatch.
 */
export function kodoWorkerInstanceIds(input: {
  readonly modeModels: KodoModeModels;
  readonly mode: unknown;
  readonly inherited: string;
}): ReadonlyArray<string> {
  const slot = input.modeModels[kodoModeModelSlot(input.mode)];
  return slot === null || slot.instanceId === input.inherited
    ? [input.inherited]
    : [slot.instanceId, input.inherited];
}
