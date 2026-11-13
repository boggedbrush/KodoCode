import { describe, expect, it } from "@effect/vitest";

import {
  kodoRunningWorkers,
  kodoWorkersBannerTitle,
  registerKodoSubAgentsToggle,
  requestKodoSubAgentsToggle,
} from "./subAgents.logic";

const task = (status: string, child: string | null, origin = "app_owned") =>
  ({ origin, status, childThreadId: child }) as never;

describe("workers still running", () => {
  it("counts delegated tasks that have not finished, once per worker thread", () => {
    expect(
      kodoRunningWorkers([
        task("running", "a"),
        task("waiting", "b"),
        task("pending", "c"),
        task("completed", "d"),
        task("failed", "e"),
        task("running", "a"),
      ]),
    ).toBe(3);
  });

  it("does not count a provider's own subagents", () => {
    expect(kodoRunningWorkers([task("running", "a", "provider_native")])).toBe(0);
  });

  it("titles the banner in the singular and the plural", () => {
    expect(kodoWorkersBannerTitle(1)).toBe("1 worker running");
    expect(kodoWorkersBannerTitle(3)).toBe("3 workers running");
  });
});

describe("the toggle the palette and the keybinding ask for", () => {
  it("asks the latest mounted composer, and says when there is none", () => {
    expect(requestKodoSubAgentsToggle()).toBe(false);
    const calls: string[] = [];
    const first = registerKodoSubAgentsToggle(() => calls.push("first"));
    const second = registerKodoSubAgentsToggle(() => calls.push("second"));
    expect(requestKodoSubAgentsToggle()).toBe(true);
    second();
    expect(requestKodoSubAgentsToggle()).toBe(true);
    first();
    expect(requestKodoSubAgentsToggle()).toBe(false);
    expect(calls).toEqual(["second", "first"]);
  });
});
