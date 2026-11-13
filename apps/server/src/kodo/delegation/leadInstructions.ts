// The text a lead thread's model is given with each message. It is model-facing: changes here need
// the evals in evals/README.md (the cases to add are listed in the Sub-agents section of the
// release notes). The block rides in front of the person's text like a mode block, so it holds
// for the whole thread; one short block says when sub-agents are turned off again.
import { normalizeKodoInteractionMode, type KodoInteractionMode } from "@t3tools/contracts";

const WORKERS_BY_MODE: Readonly<Record<KodoInteractionMode, string>> = {
  code: `- Code changes go to a Code worker: \`delegate_task\` with role "implementation" (or "test"). Reviews go to a Review worker: role "review".
- Do not edit files yourself. Read, plan, delegate, then verify.`,
  review: `- This thread is read-only, so only Review workers can run: use \`delegate_task\` with role "review", for example one per area of the change.
- Do not edit files; no worker may either.`,
  plan: `- This thread is read-only, so only read-only workers can run: use role "research" to investigate and role "design" to draft options.
- Do not edit files; no worker may either.`,
  ask: `- This thread is read-only, so only read-only workers can run: use role "research" to look things up in the code.
- Do not edit files; no worker may either.`,
};

export const kodoLeadInstructions = (mode: unknown): string => {
  const normalized = normalizeKodoInteractionMode(mode);
  return `<kodo_sub_agents>
# Sub-agents: you lead

You lead workers on this thread. You plan, delegate and verify; the workers do the implementing and the reviewing.

${WORKERS_BY_MODE[normalized]}
- Never name a model, provider or effort in \`target\`. Each worker runs on the model set for its mode, and anything you name is ignored.
- Give each worker one self-contained task with the files, the goal and what done looks like. Use mode "wait" when this turn needs the result.
- A worker's result is a claim, not proof. Read what it reports and check the changed files or the diff with read-only commands before you tell the person it is done. Send fixes back to a worker.
- Do not use your provider's built-in subagents or Task tool: they bypass the models the person chose.
- Workers cannot start workers. A few run at once at most; if \`delegate_task\` is refused (a cap or a usage limit), tell the person why instead of doing the work yourself.
- For work that needs several rounds (implement, review, fix until clean), prefer \`t3_loop_start\` on another idle thread: a loop runs without lead turns, so it costs less.

This stays in force for the whole thread until a message carries a kodo_sub_agents block that turns it off.
</kodo_sub_agents>`;
};

export const KODO_SUB_AGENTS_OFF_INSTRUCTIONS = `<kodo_sub_agents state="off">
Sub-agents are off. You no longer lead workers: do the work yourself, as in any other thread, within this thread's mode.
</kodo_sub_agents>`;
