import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_KODO_MODE_MODELS,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import {
  kodoProviderChange,
  kodoRunModelNotice,
  resolveKodoComposerModel,
} from "./modeModels.logic";

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
  // KODO: sub-agents - a lead's label reads as the lead model, from the Orchestrator slot, not its mode's slot.
  it("reads the Orchestrator slot for a lead, whatever the thread's mode has", () => {
    const lead = createModelSelection(ProviderInstanceId.make("claudeAgent"), "ask-model");
    const modeModels = { ...DEFAULT_KODO_MODE_MODELS, code: own, orchestrator: lead };
    const result = resolveKodoComposerModel({ ...base, mode: "orchestrator", modeModels })!;
    expect(result.shown).toEqual(lead);
    expect(result.note).toMatchObject({ kind: "mode-default", label: "Lead model" });
    // Without an Orchestrator model a lead shows the thread's own model, even if Code has a default.
    expect(
      resolveKodoComposerModel({
        ...base,
        mode: "orchestrator",
        modeModels: { ...DEFAULT_KODO_MODE_MODELS, code: own },
      }),
    ).toBeNull();
  });
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

  it("a provider turned off for the project is unavailable, as the server finds it", () => {
    const settings = {
      providerInstances: {},
      projectSettingsOverrides: {
        "project-1": { providerInstances: { claudeAgent: { enabled: false } } },
      },
    } as never;
    expect(
      resolveKodoComposerModel({
        ...base,
        instanceSettings: { settings, projectId: "project-1" as never },
      }),
    ).toMatchObject({ shown: null, note: { kind: "unavailable" } });
    expect(
      resolveKodoComposerModel({
        ...base,
        instanceSettings: { settings, projectId: "other-project" as never },
      })?.shown,
    ).toEqual(ask);
  });

  it("says before the send that a default on another provider carries the conversation as a summary", () => {
    const result = resolveKodoComposerModel(base)!;
    expect(result.note?.title).toContain("instead of codex");
    expect(result.note?.title).toContain("summary");
    const sameProvider = resolveKodoComposerModel({
      ...base,
      thread: { modelSelection: createModelSelection(ProviderInstanceId.make("claudeAgent"), "x") },
    })!;
    expect(sameProvider.note?.title).not.toContain("summary");
    // The live conversation is the displaced model's, not the thread's own.
    const displaced = resolveKodoComposerModel({
      ...base,
      thread: { modelSelection: ask, kodoModeModel: { applied: ask, base: own } },
    })!;
    expect(displaced.note?.title).not.toContain("summary");
  });
});

describe("kodoProviderChange", () => {
  const continuing = [
    { ...provider("a", "claudeAgent", []), continuation: { groupKey: "g" } },
    { ...provider("b", "claudeAgent", []), continuation: { groupKey: "g" } },
  ] as unknown as ServerProvider[];
  it("is none for the same instance or instances that continue each other's conversation", () => {
    const a = createModelSelection(ProviderInstanceId.make("a"), "m");
    const b = createModelSelection(ProviderInstanceId.make("b"), "m");
    expect(kodoProviderChange(continuing, a, a)).toBeNull();
    expect(kodoProviderChange(continuing, a, b)).toBeNull();
    expect(kodoProviderChange(providers, own, ask)).toEqual({
      from: "codex",
      to: "claudeAgent",
    });
  });
});

describe("kodoRunModelNotice", () => {
  const name = (selection: { model: string }) => selection.model;
  it("says which model ran, which was wanted and why not, only for a displaced default", () => {
    expect(
      kodoRunModelNotice(
        {
          modelSelection: own,
          kodoModel: {
            source: "thread",
            base: own,
            unavailable: { wanted: ask, reason: "its provider is turned off." },
          },
        },
        name,
      ),
    ).toEqual({
      label: "Used own",
      detail: "ask-model on claudeAgent not used: its provider is turned off",
    });
    // On another provider the wanted model says which one.
    expect(
      kodoRunModelNotice(
        {
          modelSelection: own,
          kodoModel: {
            source: "thread",
            base: own,
            unavailable: { wanted: ask, reason: "its provider is turned off" },
          },
        },
        name,
        (instanceId) => `provider ${instanceId}`,
      )?.detail,
    ).toBe("ask-model on provider claudeAgent not used: its provider is turned off");
    expect(
      kodoRunModelNotice(
        { modelSelection: ask, kodoModel: { source: "mode-default", base: own } },
        name,
      ),
    ).toBeNull();
    expect(kodoRunModelNotice({ modelSelection: own }, name)).toBeNull();
  });
});
