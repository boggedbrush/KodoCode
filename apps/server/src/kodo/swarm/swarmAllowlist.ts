// The only in-app tools the Orchestrator may call: read status across projects and threads, and start
// work through delegate_task. Everything else an agent could do (edit, run, launch threads, change
// projects, schedule, open a browser or a worktree) is refused at the tool door (mcp/kodoSwarmGuard.ts).
export const KODO_ORCHESTRATOR_TOOLS: ReadonlySet<string> = new Set([
  "t3_project_list",
  "t3_project_read",
  "t3_thread_list",
  "t3_thread_search",
  "t3_thread_read",
  "task_status",
  "task_cancel",
  "delegate_task",
]);

export const kodoSwarmToolRefusal = (toolName: string): string =>
  `${toolName} is not available to the Orchestrator. It can read projects and threads, and start work with delegate_task in a project the person names.`;
