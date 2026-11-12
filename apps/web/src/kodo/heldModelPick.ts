// While the composer is in a mode that has a default model, a change to the model's options (the
// reasoning effort, from the traits menu or its key) must not rewrite the thread's own model or the
// model new threads start from. It becomes a held pick of the shown model with the new options, for
// the next message only, like picking a model from the list does.
import type { ModelSelection, ProviderOptionSelection } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import { type ComposerThreadTarget, useComposerDraftStore } from "../composerDraftStore";
import type { TraitsSelectionInput } from "../components/chat/TraitsPicker";

type ProviderOptions = ReadonlyArray<ProviderOptionSelection>;

/** Holds `selection` with `options` as the draft's pick for the next message; nothing else changes. */
export function kodoHoldModelOptions(
  target: ComposerThreadTarget,
  selection: Pick<ModelSelection, "instanceId" | "model">,
  options: ProviderOptions | undefined,
): void {
  useComposerDraftStore
    .getState()
    .setModelSelection(
      target,
      createModelSelection(selection.instanceId, selection.model, options),
      { explicit: true, replaceOptions: true },
    );
}

/** The traits input with its writes routed to `onModelOptionsChange`, so it persists nowhere else. */
export function kodoRouteTraitsInput(
  traits: TraitsSelectionInput | null,
  onModelOptionsChange: ((options: ProviderOptions | undefined) => void) | undefined,
): TraitsSelectionInput | null {
  if (traits === null || onModelOptionsChange === undefined) return traits;
  const {
    threadRef: _threadRef,
    draftId: _draftId,
    onDraftModelOptionsChange: _onDraftModelOptionsChange,
    onModelOptionsChange: _onModelOptionsChange,
    ...rest
  } = traits as TraitsSelectionInput & { readonly draftId?: unknown };
  return { ...rest, onModelOptionsChange } as TraitsSelectionInput;
}
