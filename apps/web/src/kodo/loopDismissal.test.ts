import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { readDismissedLoopIds, rememberDismissedLoop } from "./loopDismissal";

const storage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
};

afterEach(() => vi.unstubAllGlobals());

describe("remembering dismissed loops", () => {
  it("remembers a loop by id across a reload, and says nothing about another loop", () => {
    vi.stubGlobal("localStorage", storage());
    const dismissed = rememberDismissedLoop(readDismissedLoopIds(), "loop-1");
    expect(dismissed.has("loop-1")).toBe(true);
    // A fresh read, as after a reload.
    const reloaded = readDismissedLoopIds();
    expect(reloaded.has("loop-1")).toBe(true);
    expect(reloaded.has("loop-2")).toBe(false);
  });

  it("keeps only the most recent ids", () => {
    vi.stubGlobal("localStorage", storage());
    let dismissed: ReadonlySet<string> = new Set();
    for (let index = 0; index < 60; index += 1) {
      dismissed = rememberDismissedLoop(dismissed, `loop-${index}`);
    }
    const reread = readDismissedLoopIds();
    expect(reread.size).toBe(50);
    expect(reread.has("loop-59")).toBe(true);
    expect(reread.has("loop-0")).toBe(false);
  });

  it("works without storage: nothing is remembered, nothing throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readDismissedLoopIds().size).toBe(0);
    expect(rememberDismissedLoop(new Set(), "loop-1").has("loop-1")).toBe(true);
  });

  it("ignores stored data that is not a list of ids", () => {
    vi.stubGlobal("localStorage", storage({ "kodo:dismissed-loops": '{"a":1}' }));
    expect(readDismissedLoopIds().size).toBe(0);
    vi.stubGlobal("localStorage", storage({ "kodo:dismissed-loops": "not json" }));
    expect(readDismissedLoopIds().size).toBe(0);
  });
});
