import { describe, expect, it } from "vite-plus/test";

import { searchSlashCommandItems } from "../components/chat/composerSlashCommandSearch";

import {
  KODO_INTERACTION_MODE_OPTIONS,
  cycleKodoInteractionMode,
  isKodoModeSlashCommand,
  KODO_MODE_SLASH_COMMAND_ITEMS,
  kodoModeSlashMatchesQuery,
  kodoModeWaitsForNextTurn,
  kodoQueuedRunModeLabel,
  parseKodoModeSlashCommand,
  parseStoredInteractionMode,
  resolveKodoDisplayedMode,
  resolveKodoInteractionMode,
  resolveKodoModeBlockHidden,
} from "./interactionModes.logic";

describe("kodo interaction modes", () => {
  it("lists the four modes in picker order, only Code being able to write", () => {
    expect(KODO_INTERACTION_MODE_OPTIONS.map((option) => option.mode)).toEqual([
      "ask",
      "plan",
      "code",
      "review",
    ]);
    expect(
      KODO_INTERACTION_MODE_OPTIONS.filter((option) => !option.readOnly).map((o) => o.mode),
    ).toEqual(["code"]);
  });

  it("resolves composer pick over thread mode, legacy default and absence as code", () => {
    expect(resolveKodoInteractionMode({ composerMode: "ask", threadMode: "review" })).toBe("ask");
    expect(resolveKodoInteractionMode({ composerMode: null, threadMode: "review" })).toBe("review");
    expect(resolveKodoInteractionMode({ composerMode: "default" })).toBe("code");
    expect(resolveKodoInteractionMode({})).toBe("code");
  });

  it("cycles ask, plan, code, review and wraps both ways", () => {
    expect(cycleKodoInteractionMode("ask")).toBe("plan");
    expect(cycleKodoInteractionMode("review")).toBe("ask");
    expect(cycleKodoInteractionMode("ask", -1)).toBe("review");
  });

  it("keeps every known stored mode and drops the rest", () => {
    for (const mode of ["ask", "plan", "code", "review", "default"]) {
      expect(parseStoredInteractionMode(mode)).toBe(mode);
    }
    expect(parseStoredInteractionMode("swarm")).toBeNull();
    expect(parseStoredInteractionMode(undefined)).toBeNull();
  });

  it("consumes a bare mode command and leaves real messages alone", () => {
    expect(parseKodoModeSlashCommand("/plan")).toBe("plan");
    expect(parseKodoModeSlashCommand("  /Review \n")).toBe("review");
    expect(parseKodoModeSlashCommand("/plan the migration")).toBeNull();
    expect(parseKodoModeSlashCommand("/planning")).toBeNull();
    expect(parseKodoModeSlashCommand("see /plan")).toBeNull();
    expect(isKodoModeSlashCommand("code")).toBe(true);
    expect(isKodoModeSlashCommand("model")).toBe(false);
  });

  it("hides the mode block only once the trailing permissions block is gone too", () => {
    expect(
      resolveKodoModeBlockHidden({ hasPermissionsBlock: true, measuredHiddenBlockCount: 1 }),
    ).toBe(false);
    expect(
      resolveKodoModeBlockHidden({ hasPermissionsBlock: true, measuredHiddenBlockCount: 2 }),
    ).toBe(true);
    expect(
      resolveKodoModeBlockHidden({ hasPermissionsBlock: false, measuredHiddenBlockCount: 1 }),
    ).toBe(true);
  });

  it("shows a server thread's own mode, not a stale draft pick", () => {
    const base = { isServerThread: true, pendingMode: null, composerMode: "ask" as const };
    expect(resolveKodoDisplayedMode({ ...base, threadMode: "review" })).toBe("review");
    expect(resolveKodoDisplayedMode({ ...base, threadMode: "code" })).toBe("code");
    expect(resolveKodoDisplayedMode({ ...base, threadMode: "default" })).toBe("code");
    expect(resolveKodoDisplayedMode({ ...base, threadMode: undefined })).toBe("code");
  });

  it("shows the pick that is on its way to the server over the server's mode", () => {
    expect(
      resolveKodoDisplayedMode({
        isServerThread: true,
        pendingMode: "plan",
        threadMode: "default",
        composerMode: null,
      }),
    ).toBe("plan");
  });

  it("keeps the draft's pick only for a thread the server does not have yet", () => {
    const base = { isServerThread: false, pendingMode: null, threadMode: "code" as const };
    expect(resolveKodoDisplayedMode({ ...base, composerMode: "ask" })).toBe("ask");
    expect(resolveKodoDisplayedMode({ ...base, composerMode: null })).toBe("code");
    expect(resolveKodoDisplayedMode({ ...base, composerMode: "default" })).toBe("code");
  });

  it("labels a queued message only when its recorded mode differs from the thread's", () => {
    expect(kodoQueuedRunModeLabel({ runMode: "ask", threadMode: "code" })).toBe("Ask");
    expect(kodoQueuedRunModeLabel({ runMode: "review", threadMode: "plan" })).toBe("Review");
    expect(kodoQueuedRunModeLabel({ runMode: "ask", threadMode: "ask" })).toBeNull();
    expect(kodoQueuedRunModeLabel({ runMode: "default", threadMode: "code" })).toBeNull();
    expect(kodoQueuedRunModeLabel({ runMode: undefined, threadMode: "code" })).toBeNull();
  });

  it("flags a mode that waits for the next turn only while a turn runs in another mode", () => {
    const running = { activeRunId: "run-1", runStartedInMode: "code" as const };
    expect(kodoModeWaitsForNextTurn({ ...running, displayedMode: "ask" })).toBe(true);
    expect(kodoModeWaitsForNextTurn({ ...running, displayedMode: "code" })).toBe(false);
    expect(
      kodoModeWaitsForNextTurn({
        activeRunId: null,
        runStartedInMode: "code",
        displayedMode: "ask",
      }),
    ).toBe(false);
  });

  it("matches mode commands by name prefix, ranked first, not by description words", () => {
    const items = [
      {
        id: "m",
        type: "slash-command" as const,
        command: "model" as const,
        label: "/model",
        description: "Switch response model for this thread",
      },
      ...KODO_MODE_SLASH_COMMAND_ITEMS.map((item) => ({
        id: item.command,
        type: "slash-command" as const,
        ...item,
      })),
    ];
    const lookup = (query: string) =>
      searchSlashCommandItems(items, query)
        .filter(
          (item) =>
            item.type !== "slash-command" ||
            !isKodoModeSlashCommand(item.command) ||
            kodoModeSlashMatchesQuery(item.command, query),
        )
        .map((item) => (item.type === "slash-command" ? item.command : item.label));
    // Upstream's own search still lists /code and /ask for "pl" via their descriptions.
    expect(searchSlashCommandItems(items, "pl").length).toBeGreaterThan(1);
    expect(lookup("pl")).toEqual(["plan"]);
    expect(lookup("/PL")).toEqual(["plan"]);
    expect(lookup("mo")).toEqual(["model"]);
    expect(lookup("c")[0]).toBe("code");
  });
});
