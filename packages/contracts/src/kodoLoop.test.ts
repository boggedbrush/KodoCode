import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  DEFAULT_KODO_LOOP_SETTINGS,
  KodoLoop,
  KodoLoopControl,
  KodoLoopSetting,
  KodoLoopSettingsPatch,
} from "./kodoLoop.ts";
import { OrchestrationV2Command } from "./orchestrationV2.ts";
import { ServerSettings } from "./settings.ts";

const decode = Schema.decodeUnknownSync(KodoLoopSetting);
const decodeLoop = Schema.decodeUnknownSync(KodoLoop);
const decodeControl = Schema.decodeUnknownSync(KodoLoopControl);
const decodeSettings = Schema.decodeSync(ServerSettings);
const encodeSettings = Schema.encodeSync(ServerSettings);

const configured = {
  defaultMaxRounds: 5,
  planApproval: "ask",
  budget: { stopAtLimitPercent: 75, maxCostUsd: 2.5, maxTokens: 400_000 },
} as const;

describe("loop settings decoding", () => {
  it("settings written before the section existed decode to the defaults", () => {
    expect(decodeSettings({}).loop).toEqual(DEFAULT_KODO_LOOP_SETTINGS);
    expect(DEFAULT_KODO_LOOP_SETTINGS).toEqual({
      defaultMaxRounds: 3,
      planApproval: "auto",
      budget: { stopAtLimitPercent: 90, maxCostUsd: null, maxTokens: null },
    });
  });

  it("keeps a valid section as written", () => {
    expect(decode(configured)).toEqual(configured);
  });

  it.each([
    ["rounds out of range", { defaultMaxRounds: 99 }, { defaultMaxRounds: 3 }],
    ["rounds not an integer", { defaultMaxRounds: 2.5 }, { defaultMaxRounds: 3 }],
    ["unknown approval", { planApproval: "sometimes" }, { planApproval: "auto" }],
    [
      "limit percent of the wrong type",
      { budget: { ...configured.budget, stopAtLimitPercent: "high" } },
      { budget: { ...configured.budget, stopAtLimitPercent: 90 } },
    ],
    [
      "cost cap of zero",
      { budget: { ...configured.budget, maxCostUsd: 0 } },
      { budget: { ...configured.budget, maxCostUsd: null } },
    ],
    [
      "budget that is not a record",
      { budget: "lots" },
      { budget: DEFAULT_KODO_LOOP_SETTINGS.budget },
    ],
  ])("a malformed field reads as its default and keeps its neighbours: %s", (_name, bad, fixed) => {
    expect(decode({ ...configured, ...bad })).toEqual({ ...configured, ...fixed });
    expect(decodeSettings({ loop: { ...configured, ...bad } }).loop).toEqual({
      ...configured,
      ...fixed,
    });
  });

  it("a section that is not a record reads as the defaults", () => {
    expect(decode("garbage")).toEqual(DEFAULT_KODO_LOOP_SETTINGS);
    expect(decode(null)).toEqual(DEFAULT_KODO_LOOP_SETTINGS);
  });

  it("round-trips through the settings encoding", () => {
    const settings = decodeSettings({ loop: configured });
    expect(decodeSettings(encodeSettings(settings)).loop).toEqual(configured);
  });
});

describe("loop settings patch", () => {
  const decodePatch = Schema.decodeUnknownSync(KodoLoopSettingsPatch);

  it("names only what it changes and clears a cap with null", () => {
    expect(decodePatch({ budget: { maxCostUsd: null } })).toEqual({ budget: { maxCostUsd: null } });
  });

  it("refuses out-of-range values rather than storing them", () => {
    expect(() => decodePatch({ defaultMaxRounds: 0 })).toThrow();
    expect(() => decodePatch({ budget: { stopAtLimitPercent: 101 } })).toThrow();
  });
});

const isClientCommand = Schema.is(OrchestrationV2Command);

describe("loop commands on the wire", () => {
  const control = {
    type: "thread.kodo-loop.control",
    commandId: "c1",
    threadId: "t1",
    control: { type: "stop" },
  };
  const advance = {
    type: "thread.kodo-loop.advance",
    commandId: "c2",
    threadId: "t1",
    loopId: "L1",
    expectedRevision: 1,
    step: { type: "release" },
  };

  it("a client may send the control command but never the internal advance", () => {
    expect(isClientCommand(control)).toBe(true);
    expect(isClientCommand(advance)).toBe(false);
  });
});

describe("a stored loop", () => {
  const base = {
    loopId: "L1",
    revision: 2,
    status: "stopped",
    stopReason: "round_cap",
    round: 1,
    maxRounds: 1,
    stage: "judge",
    request: "Do it.",
    requestMessageId: "m",
    startMode: "code",
    planApproval: "auto",
    budget: {},
    baseline: { runOrdinal: 3 },
  } as const;
  const stored = (stages: unknown) => decodeLoop({ ...base, stages });

  it("written before its records were cut to headlines still decodes, with no records", () => {
    const legacy = {
      round: 1,
      stage: "judge",
      messageId: "kodo-loop-L1-r1-judge",
      runId: "r",
      status: "completed",
      model: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      verdict: { version: 1, complete: false, summary: "s", outstanding: [], approach: "a" },
    };
    expect(stored([legacy]).stages).toEqual([]);
  });

  it("keeps the records that are in the current shape", () => {
    const record = {
      round: 1,
      stage: "judge",
      messageId: "kodo-loop-L1-r1-judge",
      runId: "r",
      status: "completed",
      model: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      conclusion: "Not done.",
      verdict: { complete: false, outstandingCount: 1, outstanding: [{ title: "No test" }] },
    };
    expect(stored([record]).stages).toHaveLength(1);
  });

  it("owes nothing unless it says so, and a start may carry the message as sent", () => {
    expect(stored([]).cleanup).toBeUndefined();
    const start = decodeControl({
      type: "start",
      request: "x",
      requestMessageId: "m",
      requestMessage: { text: "/loop x", createdBy: "user", creationSource: "web" },
      maxRounds: 2,
      planApproval: "auto",
      budget: {},
    } as unknown);
    expect(start.type === "start" && start.requestMessage?.text).toBe("/loop x");
  });
});
