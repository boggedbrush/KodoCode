import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_KODO_MODE_MODELS, ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import { resolveKodoModeModel } from "./modeModel.ts";

const sel = (instance: string, model: string) =>
  createModelSelection(ProviderInstanceId.make(instance), model);
const own = sel("codex", "own");
const ask = sel("claudeAgent", "ask-model");
const picked = sel("codex", "picked");
const settings = { modeModelSelections: { ...DEFAULT_KODO_MODE_MODELS, ask } };

describe("resolveKodoModeModel", () => {
  it("applies the mode default to a send that only carries the thread's model", () => {
    const resolved = resolveKodoModeModel({
      mode: "ask",
      thread: { modelSelection: own },
      settings,
      requested: own,
    });
    expect(resolved).toMatchObject({ selection: ask, source: "mode-default" });
  });

  it("keeps a selection that is neither the thread's nor the mode's (agents, scheduled tasks)", () => {
    expect(
      resolveKodoModeModel({
        mode: "ask",
        thread: { modelSelection: own },
        settings,
        requested: picked,
      }),
    ).toMatchObject({ selection: picked, source: "explicit" });
  });

  it("an unflagged carried selection does not beat the default, a flagged one does", () => {
    const base = { mode: "ask", thread: { modelSelection: own }, settings, requested: picked };
    expect(resolveKodoModeModel({ ...base, explicitPick: false }).selection).toEqual(ask);
    expect(resolveKodoModeModel({ ...base, explicitPick: true }).selection).toEqual(picked);
  });

  it("a mode without a default follows the thread, and the displaced default is not its model", () => {
    const displaced = { modelSelection: ask, kodoModeModel: { applied: ask, base: own } };
    expect(resolveKodoModeModel({ mode: "code", thread: displaced, settings }).selection).toEqual(
      own,
    );
    // The composer reads the own model through the live session's provider instance and says it is
    // only carrying it. Without the flag the same selection is a choice, and is honoured.
    const viaLiveSession = sel("claudeAgent", "own");
    expect(
      resolveKodoModeModel({
        mode: "code",
        thread: displaced,
        settings,
        requested: viaLiveSession,
        explicitPick: false,
      }).selection,
    ).toEqual(own);
    expect(
      resolveKodoModeModel({ mode: "code", thread: displaced, settings, requested: viaLiveSession })
        .selection,
    ).toEqual(viaLiveSession);
    // A client that carries the applied model back (mobile) is not picking it.
    expect(
      resolveKodoModeModel({ mode: "code", thread: displaced, settings, requested: ask }).selection,
    ).toEqual(own);
  });

  it("falls back to what the sender carried when the default cannot run", () => {
    const resolved = resolveKodoModeModel({
      mode: "ask",
      thread: { modelSelection: own },
      settings,
      requested: own,
      availability: () => "its provider is turned off",
    });
    expect(resolved.selection).toEqual(own);
    expect(resolved.unavailable?.wanted).toEqual(ask);
  });

  it("resolves the orchestrator and judge roles through the same function", () => {
    const roles = {
      modeModelSelections: { ...DEFAULT_KODO_MODE_MODELS, review: ask, orchestrator: picked },
    };
    const thread = { modelSelection: own };
    expect(
      resolveKodoModeModel({ mode: "orchestrator", thread, settings: roles }).selection,
    ).toEqual(picked);
    expect(resolveKodoModeModel({ mode: "judge", thread, settings: roles }).selection).toEqual(ask);
  });

  it("while displaced, a sender that names the thread's base model without the flag has chosen it", () => {
    const planSettings = {
      modeModelSelections: { ...DEFAULT_KODO_MODE_MODELS, plan: ask },
    };
    const displaced = { modelSelection: ask, kodoModeModel: { applied: ask, base: own } };
    const base = { mode: "plan", thread: displaced, settings: planSettings };
    // Mobile picked the base model: it wins over the Plan default, and is the thread's model only
    // in a mode without one.
    expect(resolveKodoModeModel({ ...base, requested: own })).toMatchObject({
      selection: own,
      source: "explicit",
      own,
    });
    // Carrying the displaced model back is not a pick.
    expect(resolveKodoModeModel({ ...base, requested: ask })).toMatchObject({
      selection: ask,
      source: "mode-default",
    });
  });

  it("a pick in a mode without a default is the thread's own model afterwards", () => {
    expect(
      resolveKodoModeModel({
        mode: "code",
        thread: { modelSelection: own },
        settings,
        requested: picked,
        explicitPick: true,
      }),
    ).toMatchObject({ selection: picked, own: picked, hasDefault: false });
  });
});
