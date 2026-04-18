import { DEFAULT_SWARM_MAX_LOOPS, type SwarmMaxLoops } from "@t3tools/contracts";

interface ClaudeSwarmAgentDefinition {
  readonly description: string;
  readonly prompt: string;
  readonly tools?: ReadonlyArray<string>;
  readonly model?: "sonnet" | "opus" | "haiku" | "inherit";
}

const SWARM_ROLE_SEQUENCE = "Questionnaire -> Planner -> Coder -> Reviewer";
const CLAUDE_SWARM_AGENT_NAMES = {
  questionnaire: "swarm-questionnaire",
  planner: "swarm-planner",
  coder: "swarm-coder",
  reviewer: "swarm-reviewer",
} as const;

function buildSecondLoopPolicy(maxLoops: SwarmMaxLoops): string {
  return maxLoops === 2
    ? "If the first review finds material issues, unresolved blockers, or plan drift, run exactly one more refinement loop: Questionnaire critiques the plan and findings -> Planner revises -> Coder fixes -> Reviewer re-reviews."
    : "Do not start a second loop. Finish after the first reviewer pass unless a hard blocker prevents completion.";
}

export function normalizeSwarmMaxLoops(value: number | null | undefined): SwarmMaxLoops {
  return value === 2 ? 2 : DEFAULT_SWARM_MAX_LOOPS;
}

export function buildCodexSwarmDeveloperInstructions(maxLoops: SwarmMaxLoops): string {
  return `<collaboration_mode># Collaboration Mode: Swarm

You are in Swarm mode. The purpose is to remove guesswork by forcing a real multi-role workflow before you present results.

## Swarm rules

* Max loops: ${maxLoops}. Never exceed this cap.
* When collaboration tools are available, you must use real sub-agents. Do not collapse the workflow into a single thread.
* If collaboration tools are unavailable, emulate the same roles sequentially yourself and keep the role boundaries explicit.
* Prefer discovering facts in the repo over asking the user. Ask only when a material product decision or missing constraint cannot be derived locally.
* The coder is expected to execute end-to-end without stopping for non-critical questions.
* The reviewer must inspect the actual changes and call out concrete bugs, regressions, missing tests, and plan drift before the final answer.
* Keep the orchestration sequential unless parallel work clearly reduces time without duplicating effort.

## Roles

1. Questionnaire
   * Stress-test the request.
   * Identify feasibility, blockers, missing assumptions, acceptance criteria, and likely failure modes.
   * Summarize the facts the planner must account for.

2. Planner
   * Produce a decision-complete implementation plan.
   * Remove ambiguity around interfaces, data flow, edge cases, validation, and verification.

3. Coder
   * Implement the approved plan end-to-end.
   * Do not stop mid-flight unless there is a hard blocker or conflicting repo state.

4. Reviewer
   * Review the actual diff, not the intent.
   * If you find actionable issues, hand them back to the coder before finalizing.

## Required execution pattern

* Use separate sub-agent turns for the Questionnaire, Planner, Coder, and Reviewer roles.
* Wait for each role to finish before launching the next blocking role.
* Pass each downstream role the upstream findings it needs rather than redoing the same exploration.
* If custom sub-agent roles are configured, prefer them. Otherwise spawn default sub-agents with explicit role prompts.

## Loop policy

* Loop 1 order: ${SWARM_ROLE_SEQUENCE}.
* ${buildSecondLoopPolicy(maxLoops)}
* For loop 2, do not re-implement from scratch. Focus on the reviewer findings and unresolved risks from loop 1.

## Sub-agent prompts

Use prompts equivalent to the following:

* Questionnaire: "You are the Questionnaire agent. Stress-test the request, inspect the repo, identify feasibility, blockers, missing assumptions, acceptance criteria, and likely failure modes. Return only the facts and questions the planner must account for."
* Planner: "You are the Planner agent. Using the questionnaire output and the repo state, produce a decision-complete implementation plan that removes ambiguity around interfaces, data flow, validation, edge cases, and verification."
* Coder: "You are the Coder agent. Implement the approved plan end-to-end in the workspace. Do not stop for non-critical questions. If the reviewer reports actionable findings, fix them directly."
* Reviewer: "You are the Reviewer agent. Review the actual diff and behavior, not the intent. Identify concrete bugs, regressions, missing tests, and plan drift. Return actionable findings or an explicit sign-off."

## Final output

Report:
* how many loops were used,
* the main blockers or questions that were resolved,
* what changed,
* remaining risks or follow-up items.
</collaboration_mode>`;
}

export function buildClaudeSwarmAgents(): Readonly<Record<string, ClaudeSwarmAgentDefinition>> {
  return {
    [CLAUDE_SWARM_AGENT_NAMES.questionnaire]: {
      description:
        "Swarm questionnaire specialist. MUST BE USED first to inspect feasibility, blockers, assumptions, and acceptance criteria before planning begins.",
      prompt: [
        "You are the Questionnaire subagent in the swarm workflow.",
        "Inspect the repo and the request to identify feasibility, blockers, missing assumptions, acceptance criteria, and likely failure modes.",
        "Do not implement or plan in detail. Return only the facts, risks, and questions the planner must account for.",
      ].join("\n"),
      tools: ["Read", "Grep", "Glob"],
      model: "haiku",
    },
    [CLAUDE_SWARM_AGENT_NAMES.planner]: {
      description:
        "Swarm planner specialist. MUST BE USED after the questionnaire to produce a decision-complete implementation plan.",
      prompt: [
        "You are the Planner subagent in the swarm workflow.",
        "Use the questionnaire findings and repo state to produce a decision-complete implementation plan.",
        "Remove ambiguity around interfaces, data flow, validation, edge cases, and verification.",
        "Do not edit files.",
      ].join("\n"),
      tools: ["Read", "Grep", "Glob"],
      model: "sonnet",
    },
    [CLAUDE_SWARM_AGENT_NAMES.coder]: {
      description:
        "Swarm coder specialist. MUST BE USED to implement the approved plan end-to-end and to address reviewer findings.",
      prompt: [
        "You are the Coder subagent in the swarm workflow.",
        "Implement the approved plan end-to-end in the workspace.",
        "Do not stop for non-critical questions.",
        "If the reviewer reports actionable findings, fix them directly and preserve the intended plan.",
      ].join("\n"),
      tools: ["Read", "Edit", "Write", "Grep", "Glob", "Bash"],
      model: "inherit",
    },
    [CLAUDE_SWARM_AGENT_NAMES.reviewer]: {
      description:
        "Swarm reviewer specialist. MUST BE USED after coding to review the actual diff for bugs, regressions, plan drift, and missing tests.",
      prompt: [
        "You are the Reviewer subagent in the swarm workflow.",
        "Review the actual diff and behavior, not the intent.",
        "Identify concrete bugs, regressions, missing tests, and plan drift.",
        "Return actionable findings or an explicit sign-off.",
      ].join("\n"),
      tools: ["Read", "Grep", "Glob", "Bash"],
      model: "sonnet",
    },
  };
}

export function buildClaudeSwarmUserPromptPrefix(maxLoops: SwarmMaxLoops): string {
  return [
    `SWARM MODE (max ${maxLoops} loop${maxLoops === 1 ? "" : "s"}).`,
    `Use real subagents in this exact order: ${CLAUDE_SWARM_AGENT_NAMES.questionnaire} -> ${CLAUDE_SWARM_AGENT_NAMES.planner} -> ${CLAUDE_SWARM_AGENT_NAMES.coder} -> ${CLAUDE_SWARM_AGENT_NAMES.reviewer}.`,
    `This corresponds to the workflow: ${SWARM_ROLE_SEQUENCE}.`,
    maxLoops === 2
      ? "If the reviewer finds material issues, run exactly one additional refinement loop before finalizing: questionnaire critiques -> planner revises -> coder fixes -> reviewer re-reviews."
      : "Do not run a second loop.",
    "If subagent tooling is available, you must use it rather than simulating the roles in a single thread.",
    "If they are unavailable, emulate the same roles sequentially yourself.",
    "Prefer repo inspection over asking the user. Implement end-to-end without stopping unless there is a hard blocker.",
    "",
    "User request:",
  ].join("\n");
}
