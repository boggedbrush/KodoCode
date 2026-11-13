// The Orchestrator's project belongs to the server. No client or agent may create, change or delete
// it (the id is fixed, so anyone could otherwise squat on it or re-root it), and the server alone
// puts it right again when something left it deleted, archived or pointing at another folder.
import {
  CommandId,
  KODO_ORCHESTRATOR_PROJECT_ID,
  KODO_ORCHESTRATOR_TITLE,
  isKodoOrchestratorProjectId,
} from "@t3tools/contracts";

const KODO_ORCHESTRATOR_PROJECT_REFUSAL =
  "The Orchestrator's project is managed by the server and cannot be created, changed or deleted.";

/** The reason a project command on this id is refused, or undefined for any other project. */
export const kodoOrchestratorProjectRefusal = (projectId: string): string | undefined =>
  isKodoOrchestratorProjectId(projectId) ? KODO_ORCHESTRATOR_PROJECT_REFUSAL : undefined;

export interface KodoOrchestratorProjectRow {
  readonly deletedAt: unknown;
  readonly archivedAt: unknown;
  readonly workspaceRoot: string;
  readonly updatedAt: unknown;
}

/**
 * What puts the project right: nothing when it is as it should be, a create when there is none or it
 * was deleted (the planner allows that for this id alone), or a repair of its folder and archive state.
 * The command ids follow the state they replace, so two racing calls plan the same command.
 */
export function planKodoOrchestratorProject(input: {
  readonly existing: KodoOrchestratorProjectRow | undefined;
  readonly workspaceRoot: string;
}):
  | { readonly type: "create"; readonly commandId: CommandId; readonly title: string }
  | {
      readonly type: "repair";
      readonly commandId: CommandId;
      readonly workspaceRoot: string | undefined;
    }
  | undefined {
  const base = `${KODO_ORCHESTRATOR_PROJECT_ID}:project`;
  const { existing } = input;
  if (existing === undefined) {
    return { type: "create", commandId: CommandId.make(base), title: KODO_ORCHESTRATOR_TITLE };
  }
  if (existing.deletedAt !== null) {
    return {
      type: "create",
      commandId: CommandId.make(`${base}:restore:${String(existing.deletedAt)}`),
      title: KODO_ORCHESTRATOR_TITLE,
    };
  }
  if (existing.archivedAt === null && existing.workspaceRoot === input.workspaceRoot) {
    return undefined;
  }
  return {
    type: "repair",
    commandId: CommandId.make(`${base}:repair:${String(existing.updatedAt)}`),
    workspaceRoot: existing.workspaceRoot === input.workspaceRoot ? undefined : input.workspaceRoot,
  };
}
