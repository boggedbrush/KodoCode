import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_KODO_MODE_MODELS,
  type KodoModeModels,
  ProviderInstanceId,
} from "@t3tools/contracts";

import {
  kodoOwnModelAfterQueue,
  kodoSendIsExplicitPick,
  kodoInstanceTurnedOff,
  kodoThreadModeModelFor,
  kodoThreadOwnModel,
  resolveKodoModeModelSelection,
} from "./kodoModeModel.ts";
import { createModelSelection } from "./model.ts";

const sel = (instance: string, model: string, effort?: string) =>
  createModelSelection(
    ProviderInstanceId.make(instance),
    model,
    effort === undefined ? undefined : [{ id: "reasoningEffort", value: effort }],
  );

const own = sel("codex", "gpt-own");
const fast = sel("claudeAgent", "haiku");
const strong = sel("claudeAgent", "opus", "high");
const judgeModel = sel("codex", "gpt-judge");
const models = (patch: Partial<KodoModeModels>): KodoModeModels => ({
  ...DEFAULT_KODO_MODE_MODELS,
  ...patch,
});
const never = () => "provider is off";

describe("resolveKodoModeModelSelection precedence", () => {
  const cases: ReadonlyArray<{
    name: string;
    mode: string | undefined;
    modeModels: KodoModeModels;
    explicit?: ReturnType<typeof sel>;
    availability?: () => string | null;
    expected: ReturnType<typeof sel>;
    source: string;
    unavailable?: boolean;
  }> = [
    {
      name: "nothing configured follows the thread",
      mode: "ask",
      modeModels: models({}),
      expected: own,
      source: "thread",
    },
    {
      name: "configured mode runs on it",
      mode: "ask",
      modeModels: models({ ask: fast }),
      expected: fast,
      source: "mode-default",
    },
    {
      name: "other modes keep the thread model",
      mode: "code",
      modeModels: models({ ask: fast }),
      expected: own,
      source: "thread",
    },
    {
      name: "legacy default reads as code",
      mode: "default",
      modeModels: models({ code: strong }),
      expected: strong,
      source: "mode-default",
    },
    {
      name: "unknown mode reads as ask (fail closed)",
      mode: "weird",
      modeModels: models({ ask: fast }),
      expected: fast,
      source: "mode-default",
    },
    {
      name: "explicit pick wins over the mode",
      mode: "plan",
      modeModels: models({ plan: strong }),
      explicit: fast,
      expected: fast,
      source: "explicit",
    },
    {
      name: "unavailable configured model falls back with a notice",
      mode: "plan",
      modeModels: models({ plan: strong }),
      availability: never,
      expected: own,
      source: "thread",
      unavailable: true,
    },
    {
      name: "orchestrator slot resolves like a mode",
      mode: "orchestrator",
      modeModels: models({ orchestrator: strong }),
      expected: strong,
      source: "mode-default",
    },
    {
      name: "judge uses its own model",
      mode: "judge",
      modeModels: models({ judge: judgeModel, review: strong }),
      expected: judgeModel,
      source: "mode-default",
    },
    {
      name: "judge falls back to review",
      mode: "judge",
      modeModels: models({ review: strong }),
      expected: strong,
      source: "mode-default",
    },
    {
      name: "judge with no review follows the thread",
      mode: "judge",
      modeModels: models({}),
      expected: own,
      source: "thread",
    },
    {
      name: "judge falls back to review, then the thread when review is unavailable",
      mode: "judge",
      modeModels: models({ review: strong }),
      availability: never,
      expected: own,
      source: "thread",
      unavailable: true,
    },
    {
      name: "review does not borrow from judge",
      mode: "review",
      modeModels: models({ judge: judgeModel }),
      expected: own,
      source: "thread",
    },
  ];
  it.each(cases)("$name", (c) => {
    const resolved = resolveKodoModeModelSelection({
      mode: c.mode,
      own,
      modeModels: c.modeModels,
      explicit: c.explicit,
      ...(c.availability === undefined ? {} : { availability: c.availability }),
    });
    expect(resolved.selection).toEqual(c.expected);
    expect(resolved.source).toBe(c.source);
    expect(resolved.unavailable !== null).toBe(c.unavailable === true);
  });
});

describe("own model while a mode default displaces it", () => {
  it("reads the base only while the applied selection is still the thread's", () => {
    const record = { applied: fast, base: own };
    expect(kodoThreadOwnModel({ modelSelection: fast, kodoModeModel: record })).toEqual(own);
    expect(kodoThreadOwnModel({ modelSelection: strong, kodoModeModel: record })).toEqual(strong);
    expect(kodoThreadOwnModel({ modelSelection: own })).toEqual(own);
  });

  it("records a displacement only for a mode default that differs", () => {
    expect(kodoThreadModeModelFor({ selection: fast, source: "mode-default", own })).toEqual({
      applied: fast,
      base: own,
    });
    expect(kodoThreadModeModelFor({ selection: own, source: "mode-default", own })).toBeUndefined();
    expect(kodoThreadModeModelFor({ selection: own, source: "thread", own })).toBeUndefined();
  });

  it("a pick in a mode with a default is displaced like one; without a default it is the thread's own", () => {
    const withDefault = resolveKodoModeModelSelection({
      mode: "ask",
      own,
      modeModels: models({ ask: fast }),
      explicit: strong,
    });
    expect(withDefault).toMatchObject({ source: "explicit", own, hasDefault: true });
    expect(kodoThreadModeModelFor(withDefault)).toEqual({ applied: strong, base: own });
    const withoutDefault = resolveKodoModeModelSelection({
      mode: "ask",
      own,
      modeModels: models({}),
      explicit: strong,
    });
    expect(withoutDefault).toMatchObject({ source: "explicit", own: strong, hasDefault: false });
    expect(kodoThreadModeModelFor(withoutDefault)).toBeUndefined();
  });

  it("a queue tail supplies the own model for runs queued behind it", () => {
    const thread = { modelSelection: own };
    expect(
      kodoOwnModelAfterQueue(thread, {
        modelSelection: fast,
        kodoModel: { source: "mode-default", base: own },
      }),
    ).toEqual(own);
    // A pick in a mode with a default keeps the thread's own model as its base.
    expect(
      kodoOwnModelAfterQueue(thread, {
        modelSelection: strong,
        kodoModel: { source: "explicit", base: own },
      }),
    ).toEqual(own);
    // A pick in a mode without one is the thread's model, which it records as its base.
    expect(
      kodoOwnModelAfterQueue(thread, {
        modelSelection: strong,
        kodoModel: { source: "explicit", base: strong },
      }),
    ).toEqual(strong);
    expect(kodoOwnModelAfterQueue(thread, { modelSelection: strong })).toEqual(strong);
    expect(kodoOwnModelAfterQueue(thread, undefined)).toEqual(own);
  });
});

describe("kodoSendIsExplicitPick", () => {
  const base = { own, configured: fast };
  it("trusts the client flag", () => {
    expect(kodoSendIsExplicitPick({ ...base, requested: own, flagged: true })).toBe(true);
    expect(kodoSendIsExplicitPick({ ...base, requested: strong, flagged: false })).toBe(false);
  });
  it("infers a pick from a selection that is neither the thread's nor the mode's", () => {
    expect(kodoSendIsExplicitPick({ ...base, requested: strong, flagged: undefined })).toBe(true);
    expect(kodoSendIsExplicitPick({ ...base, requested: own, flagged: undefined })).toBe(false);
    expect(kodoSendIsExplicitPick({ ...base, requested: fast, flagged: undefined })).toBe(false);
  });
  it("while displaced, an unflagged selection equal to the own model differs from the displaced state", () => {
    const displaced = { ...base, flagged: undefined, displaced: true };
    expect(kodoSendIsExplicitPick({ ...displaced, requested: own })).toBe(true);
    expect(kodoSendIsExplicitPick({ ...displaced, requested: fast })).toBe(false);
    expect(kodoSendIsExplicitPick({ ...displaced, requested: own, flagged: false })).toBe(false);
  });
  it("is never a pick when the mode has no default", () => {
    expect(
      kodoSendIsExplicitPick({ requested: strong, flagged: true, own, configured: null }),
    ).toBe(false);
  });
});

describe("kodoInstanceTurnedOff", () => {
  const settings = {
    providerInstances: { custom: { driver: "codex", enabled: false } },
    projectSettingsOverrides: { p1: { providerInstances: { custom: { enabled: true } } } },
  } as never;
  it("reads the project's override first, then the machine's, and trusts the catalogue for the rest", () => {
    expect(kodoInstanceTurnedOff(settings, null, "custom" as never)).toBe(true);
    expect(kodoInstanceTurnedOff(settings, "p1" as never, "custom" as never)).toBe(false);
    expect(kodoInstanceTurnedOff(settings, "p2" as never, "custom" as never)).toBe(true);
    expect(kodoInstanceTurnedOff(settings, null, "unconfigured" as never)).toBe(false);
  });
});
