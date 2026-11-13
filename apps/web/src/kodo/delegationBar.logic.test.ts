import type { KodoDelegationUsage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  describeKodoDelegationUsage,
  kodoUsageRefreshKey,
  kodoWorkerModeLabel,
  kodoWorkerOf,
} from "./delegationBar.logic";

const usage = (over: Partial<KodoDelegationUsage> = {}): KodoDelegationUsage =>
  ({
    threadId: "lead",
    workerCount: 2,
    unreportedWorkers: 0,
    lead: { tokens: 12_300, costUsd: 0.42, complete: true },
    workers: { tokens: 48_000, costUsd: 0.31, complete: true },
    savings: {
      actualUsd: 0.31,
      referenceUsd: 1.19,
      savedUsd: 0.88,
      savedPct: 74,
      referenceModel: { instanceId: "i", model: "big" },
      pricedWorkers: 2,
      unpricedWorkers: 0,
      sameModelWorkers: 0,
    },
    ...over,
  }) as KodoDelegationUsage;

describe("a worker's header", () => {
  it("names the lead only for a delegated worker of a thread that leads, a person's or the Orchestrator", () => {
    const lead = { title: "Refactor auth", kodoLead: { kind: "sub-agents" as const } };
    expect(kodoWorkerOf({ relationshipToParent: "subagent", parent: lead })).toEqual({
      leadTitle: "Refactor auth",
    });
    expect(kodoWorkerOf({ relationshipToParent: "fork", parent: lead })).toBeNull();
    expect(
      kodoWorkerOf({ relationshipToParent: "subagent", parent: { title: "Plain" } }),
    ).toBeNull();
    // A worker the Orchestrator started says so too: it is listed in its project, away from its lead.
    expect(
      kodoWorkerOf({
        relationshipToParent: "subagent",
        parent: { title: "Orchestrator", kodoLead: { kind: "swarm" } },
      }),
    ).toEqual({ leadTitle: "Orchestrator" });
    expect(kodoWorkerOf({ relationshipToParent: "subagent", parent: null })).toBeNull();
  });

  it("reads the mode as the picker does, and a legacy default as Code", () => {
    expect(kodoWorkerModeLabel("review")).toBe("Review");
    expect(kodoWorkerModeLabel("default")).toBe("Code");
  });
});

describe("a lead's usage line", () => {
  it("says what each side spent and the saving, as an estimate", () => {
    expect(describeKodoDelegationUsage(usage())).toEqual({
      lead: "Lead 12.3k tokens, $0.42",
      workers: "2 workers 48.0k tokens, $0.31",
      savings: "Saved about $0.88 (74%) against big (estimate)",
    });
  });

  it("says it cost more when delegating did", () => {
    const view = describeKodoDelegationUsage(
      usage({
        savings: {
          ...usage().savings!,
          savedUsd: -0.5,
          savedPct: -20,
        },
      }),
    );
    expect(view?.savings).toBe("Cost $0.50 more than big would have (20%, estimate)");
  });

  it("is a floor, never a free price, when a figure is incomplete or missing", () => {
    const view = describeKodoDelegationUsage(
      usage({
        workerCount: 3,
        unreportedWorkers: 1,
        workers: { tokens: 48_000, complete: false },
        savings: { ...usage().savings!, pricedWorkers: 0, unpricedWorkers: 2 },
      }),
    );
    expect(view?.workers).toBe("3 workers at least 48.0k tokens, no price, 1 not reported");
    expect(view?.savings).toBe("No savings estimate: the workers' models have no price.");
  });

  it("marks a saving that leaves a worker out as at least", () => {
    const view = describeKodoDelegationUsage(
      usage({ savings: { ...usage().savings!, unpricedWorkers: 1 } }),
    );
    expect(view?.savings).toBe("Saved at least about $0.88 (74%) against big (estimate)");
  });

  it("has nothing to say before any worker ran or the lead reported", () => {
    expect(
      describeKodoDelegationUsage(
        usage({ workerCount: 0, lead: undefined, workers: undefined, savings: undefined }),
      ),
    ).toBeNull();
  });

  it("says nothing was compared when the workers ran on the lead's model", () => {
    const view = describeKodoDelegationUsage(
      usage({
        savings: { ...usage().savings!, pricedWorkers: 0, sameModelWorkers: 2 },
      }),
    );
    expect(view?.savings).toBe("Nothing to compare: the workers ran on the lead's model.");
  });

  it("re-reads when a worker starts or finishes, and not for provider subagents", () => {
    const task = (origin: "app_owned" | "provider_native", status: "running" | "completed") =>
      ({ origin, status }) as never;
    const before = kodoUsageRefreshKey([task("app_owned", "running")]);
    expect(kodoUsageRefreshKey([task("app_owned", "completed")])).not.toBe(before);
    expect(
      kodoUsageRefreshKey([task("app_owned", "running"), task("app_owned", "running")]),
    ).not.toBe(before);
    expect(
      kodoUsageRefreshKey([task("app_owned", "running"), task("provider_native", "completed")]),
    ).toBe(before);
    expect(kodoUsageRefreshKey(null)).toBe("0:0");
  });
});
