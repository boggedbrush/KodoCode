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
});
