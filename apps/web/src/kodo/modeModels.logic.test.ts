import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_KODO_MODE_MODELS,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import { resolveKodoComposerModel } from "./modeModels.logic";

const own = createModelSelection(ProviderInstanceId.make("codex"), "own");
const ask = createModelSelection(ProviderInstanceId.make("claudeAgent"), "ask-model");
const provider = (instanceId: string, driver: string, models: string[]) =>
  ({
    instanceId,
    driver,
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    models: models.map((slug) => ({ slug, name: slug, isCustom: false, capabilities: null })),
  }) as unknown as ServerProvider;
const providers = [
  provider("codex", "codex", ["own"]),
  provider("claudeAgent", "claudeAgent", ["ask-model"]),
];
const base = {
  mode: "ask" as const,
  thread: { modelSelection: own },
  modeModels: { ...DEFAULT_KODO_MODE_MODELS, ask },
  providers,
  lockedDriver: null,
  explicitPick: false,
};

describe("resolveKodoComposerModel", () => {
  it("shows the mode default and says so", () => {
    const result = resolveKodoComposerModel(base)!;
    expect(result.shown).toEqual(ask);
    expect(result.note?.kind).toBe("mode-default");
  });
  it("shows nothing for a mode without a default", () => {
    expect(resolveKodoComposerModel({ ...base, mode: "code" })).toBeNull();
  });
  it("a held pick keeps the composer's own choice and is labelled", () => {
    const result = resolveKodoComposerModel({ ...base, explicitPick: true })!;
    expect(result.shown).toBeNull();
    expect(result.note?.kind).toBe("picked");
  });
  it("an unavailable default or a provider the thread is locked away from falls back with a notice", () => {
    const offline = [provider("codex", "codex", ["own"]), { ...providers[1]!, enabled: false }];
    expect(resolveKodoComposerModel({ ...base, providers: offline })).toMatchObject({
      shown: null,
      note: { kind: "unavailable" },
    });
    expect(resolveKodoComposerModel({ ...base, lockedDriver: "codex" })).toMatchObject({
      shown: null,
      note: { kind: "unavailable" },
    });
  });
});
