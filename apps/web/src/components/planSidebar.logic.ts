import type { ActivePlanState, LatestProposedPlanState } from "../session-logic";

export function shouldAutoExpandPlanMarkdown(
  activePlan: ActivePlanState | null,
  activeProposedPlan: LatestProposedPlanState | null,
): boolean {
  return activePlan === null && activeProposedPlan !== null;
}
