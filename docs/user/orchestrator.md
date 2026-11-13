# Orchestrator

The Orchestrator is one conversation across all your projects, pinned as the first row of the
thread list. Ask it what is running, what changed, or to start work in a project. It reads status
anywhere, and it never edits files or runs commands itself.

## Open it

Click **Orchestrator** at the top of the thread list. The dot beside it is grey when it is idle,
blue while it works, and amber when it needs you (an approval from a worker it started, or a
question). With the sidebar closed, the dot alone stays at the top left of the window; click it to
open the conversation. You can also use **Open Orchestrator** in the command palette, and bind a
key to `orchestrator.open` in **Settings → Keybindings**. On mobile it is the first row of the
thread list.

It is made the first time you open it, in its own folder under your T3 data directory, and it
does not appear in the thread or project lists. There is one per environment: the window shows the
one on its primary environment, and mobile the one on the environment you selected.

## What it does

- **Reads.** It can list projects and threads across all of them, search them and read one.
- **Starts work.** Only with `delegate_task`, in a project you name. It tells you the project and
  the request it would give the worker, and waits for your yes. This is only a request in its
  instructions for now, so read the request before you answer. The worker is a thread in that
  project, in the project's own folder, and it is the Orchestrator's to report on: open it from the
  Orchestrator's conversation.
- **Limits.** The workers run on the model of their mode (the Code model for a Code worker), never
  one the Orchestrator picks, with at most three running at once. Its permission mode is
  Supervised, so a worker's approvals come back to you in the Orchestrator conversation, and the
  dot turns amber. It cannot start a loop or change a project, schedule anything, or use a browser.
- **It answers when asked.** It does not watch or report on work by itself.

## Settings

**Settings → Threads → Orchestrator** turns the row off and sets its model. The model is the
**Lead / Orchestrator** model under **Models by mode**: they are the same setting, and it follows
the default model until you set it. Turning the row off hides it and the command, and keeps the
conversation.
