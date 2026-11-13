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
