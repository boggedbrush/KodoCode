# Orchestrator

The Orchestrator is one conversation across all your projects, pinned as the first row of the
thread list. Ask it what is running, what changed, or to start work in a project. It reads status
anywhere, and it never edits files or runs commands itself.

## Open it

Click **Orchestrator** at the top of the thread list. The dot beside it is grey when it is idle,
blue while it works, and amber when it needs you. It is blue while the Orchestrator itself is
running and also while any worker it started is running, even after the Orchestrator has finished
its turn. It is amber for an approval or a question from the Orchestrator or from one of its
workers, including the card that asks whether a worker may start. With the sidebar closed, the dot
alone stays at the top left of the window; click it to open the conversation. You can also use
**Open Orchestrator** in the command palette, and bind a key to `orchestrator.open` in **Settings →
Keybindings**. On mobile it is the first row of the thread list, and it scrolls away with the list.

Notifications for the Orchestrator work like any thread's, so a question it asks reaches you even
when the window is in the background.

It is made the first time you open it, in its own folder under your T3 data directory, and it
does not appear in the thread or project lists. If its model cannot receive the T3 tools (an agent
that does not mount them), the row shows a warning with the reason, and so does Settings. The
conversation's title is always **Orchestrator**; it is never renamed.

There is one per environment: the window shows the one on its primary environment, and mobile the
one on the environment you selected. The Orchestrators of other environments you have linked are not
shown in this window, and neither are their workers' conversations; open that environment's own
window to use them.

## What it does

- **Reads.** It can list projects and threads across all of them, search them and read one.
- **Starts work, after you approve it.** Only with `delegate_task`, in a project you name. When it
  wants to start a worker, nothing starts. A card appears in the Orchestrator conversation naming the
  project, the mode the worker would run in (it runs on that mode's model from Settings, or the thread's own if that is not available), and the request, with **Approve** and
  **Decline**. Only you can answer it: not the Orchestrator and not any other agent. Declining tells
  the Orchestrator it was refused. Stopping the Orchestrator's turn withdraws the card. This is a
  rule of the server, not a request in the Orchestrator's instructions, so it holds whatever the
  model does. **Settings → Threads → Orchestrator → Ask before the Orchestrator starts work** turns
  it off, and then workers start at once. Agents cannot change that setting through the app's tools.
- **Its workers are ordinary threads.** A worker is a thread in the project it works in, in the
  project's own folder. It shows in that project's thread list, with the same marker a sub-agent
  has, so you can see it running and stop it there. The Orchestrator's conversation shows what it
  and its workers have used, as a lead's does.
- **Limits.** The workers run on the model of their mode in the project they start in (the Code model
  for a Code worker), never one the Orchestrator picks, and a provider turned off for that project is
  refused. At most the worker limit in **Settings → Threads** (the one sub-agents use) run at once: three by
  default, up to six. Its permission mode is Supervised, so a worker's approvals come back to you in
  the Orchestrator conversation, and the dot turns amber. It cannot start a loop, schedule anything, or
  use a browser, and no other agent can write to its conversation or see it in their project and
  thread lists.
- **Stop all.** While workers run, the Orchestrator conversation shows a banner with **Stop all**. It
  ends every worker the Orchestrator started and leaves its own turn going.
- **It answers when asked.** It does not watch or report on work by itself.

## Settings

**Settings → Threads → Orchestrator** has:

- **Show the Orchestrator** turns the row off and hides the command. It waits while workers are
  running, with the reason shown, because turning the row off would hide the way to stop them. The
  conversation is kept.
- **Ask before the Orchestrator starts work**, on by default, as above.
- **Reset conversation** starts the Orchestrator's conversation again from nothing. It is refused while
  workers are running or a turn or a question is open. It also repairs the Orchestrator if its
  conversation or its folder was lost: opening it again makes them anew. Work its workers already did
  is not touched.
- Its model, the **Lead / Orchestrator** model under **Models by mode**. They are the same setting,
  and it follows the default model until you set it.
