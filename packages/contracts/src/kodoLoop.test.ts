import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { DEFAULT_KODO_LOOP_SETTINGS, KodoLoopSetting, KodoLoopSettingsPatch } from "./kodoLoop.ts";
import { OrchestrationV2Command } from "./orchestrationV2.ts";
import { ServerSettings } from "./settings.ts";

const decode = Schema.decodeUnknownSync(KodoLoopSetting);
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
