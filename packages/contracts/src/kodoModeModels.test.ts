import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { DEFAULT_KODO_MODE_MODELS, KodoModeModelsSetting } from "./kodoModeModels.ts";
import { ServerSettings } from "./settings.ts";

const decode = Schema.decodeUnknownSync(KodoModeModelsSetting);
const decodeSettings = Schema.decodeSync(ServerSettings);

describe("mode model settings decoding", () => {
  it("settings written before the section existed decode to all unset", () => {
    expect(decodeSettings({}).modeModelSelections).toEqual(DEFAULT_KODO_MODE_MODELS);
  });

  it("keeps configured slots, including unknown model ids, and defaults the rest", () => {
    const decoded = decode({
      plan: { instanceId: "claudeAgent", model: "model-that-no-longer-exists" },
      judge: {
        instanceId: "codex",
        model: "gpt-x",
        options: [{ id: "reasoningEffort", value: "high" }],
      },
      extraKey: 1,
    });
    expect(decoded.plan?.model).toBe("model-that-no-longer-exists");
    expect(decoded.judge?.options).toEqual([{ id: "reasoningEffort", value: "high" }]);
    expect(decoded.ask).toBeNull();
    expect(decoded.orchestrator).toBeNull();
  });

  it("a malformed slot or section reads as unset instead of failing the settings", () => {
    expect(decode({ ask: { nope: true }, code: "x" })).toEqual(DEFAULT_KODO_MODE_MODELS);
    expect(decode("garbage")).toEqual(DEFAULT_KODO_MODE_MODELS);
  });
});
