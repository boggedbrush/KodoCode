import { filterSidebarV2VisibleThreads, isSidebarHiddenThread } from "../components/Sidebar.logic";
import { describe, expect, it } from "vite-plus/test";

import {
  KODO_ORCHESTRATOR_DOT_CLASS,
  hasKodoOrchestratorOpen,
  registerKodoOrchestratorOpen,
  requestKodoOrchestratorOpen,
} from "./orchestrator.logic";

describe("the Orchestrator's dot colours", () => {
  it("is drawn in a static colour per state, with no animation", () => {
    for (const className of Object.values(KODO_ORCHESTRATOR_DOT_CLASS)) {
      expect(className).not.toMatch(/animate|pulse|ping/);
    }
    expect(new Set(Object.values(KODO_ORCHESTRATOR_DOT_CLASS)).size).toBe(3);
  });
});

describe("opening the Orchestrator from outside the row", () => {
  it("asks the latest mounted opener, and says so when none is mounted", () => {
    expect(requestKodoOrchestratorOpen()).toBe(false);
    let opened = 0;
    const dispose = registerKodoOrchestratorOpen(() => {
      opened += 1;
    });
    expect(hasKodoOrchestratorOpen()).toBe(true);
    expect(requestKodoOrchestratorOpen()).toBe(true);
    expect(opened).toBe(1);
    dispose();
    expect(hasKodoOrchestratorOpen()).toBe(false);
    expect(requestKodoOrchestratorOpen()).toBe(false);
  });
});

// What the Orchestrator starts is listed in its project, in the sidebar as everywhere else.
describe("the sidebar's lists and the Orchestrator's workers", () => {
  const lineage = (parentThreadId: string, relationshipToParent: "subagent" | "fork") => ({
    parentThreadId: parentThreadId as never,
    relationshipToParent,
    rootThreadId: parentThreadId as never,
  });
  const thread = (id: string, parentThreadId: string, relationshipToParent: "subagent" | "fork") =>
    ({
      id,
      environmentId: "env",
      projectId: "project",
      archivedAt: null,
      lineage: lineage(parentThreadId, relationshipToParent),
    }) as never;

  it("lists a worker of the Orchestrator and hides any other subagent under its parent", () => {
    expect(isSidebarHiddenThread(thread("w", "kodo-orchestrator", "subagent"))).toBe(false);
    expect(isSidebarHiddenThread(thread("w2", "kodo-orchestrator-2", "subagent"))).toBe(false);
    expect(isSidebarHiddenThread(thread("s", "ordinary-thread", "subagent"))).toBe(true);
    const listed = filterSidebarV2VisibleThreads(
      [
        thread("w", "kodo-orchestrator", "subagent"),
        thread("s", "ordinary-thread", "subagent"),
        thread("f", "ordinary-thread", "fork"),
      ],
      null,
      new Set(),
    );
    expect(listed.map((entry) => (entry as { id: string }).id)).toEqual(["w", "f"]);
  });
});
