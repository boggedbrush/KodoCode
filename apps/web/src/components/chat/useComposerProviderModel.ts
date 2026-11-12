import {
  type DraftId,
  deriveEffectiveComposerModelState,
  useComposerDraftModelState,
} from "../../composerDraftStore";
import {
  type ModelSelection,
  type ProjectId,
  ProviderDriverKind,
  type ScopedThreadRef,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  NO_PROVIDER_MODEL_SELECTION,
  providerInstanceEntriesFor,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { type UnifiedSettings } from "@t3tools/contracts/settings";
import { getComposerPromptInjectionState, getComposerProviderState } from "./composerProviderState";
import { resolveComposerProviderSelection } from "../ChatView.logic";

const NO_PROVIDER_MODELS: ServerProvider["models"] = [];

/**
 * The provider instances the composer offers, which one is selected, and the model and options
 * the draft resolves to on it. The draft store is read first so every derivation follows the only
 * hook here; in the composer body they would straddle its later hooks and lose their cache.
 */
export function useComposerProviderModel(
  input: Omit<Parameters<typeof resolveComposerProviderSelection>[0], "entries"> & {
    readonly providerStatuses: ReadonlyArray<ServerProvider>;
    readonly settings: UnifiedSettings;
    readonly activeProjectId: ProjectId | null;
    readonly threadRef: ScopedThreadRef | DraftId;
    readonly threadModelSelection: ModelSelection | null | undefined;
    readonly projectModelSelection: ModelSelection | null | undefined;
    readonly promptInjectionState: ReturnType<typeof getComposerPromptInjectionState>;
    /** KODO: mode-models-composer - the mode's default model, shown in place of the draft's pick. */
    readonly kodoModeSelection?: ModelSelection | null;
  },
) {
  const {
    providerStatuses,
    settings,
    activeProjectId,
    threadRef,
    threadModelSelection,
    projectModelSelection,
    promptInjectionState,
    candidateInstanceIds,
    lockedProvider,
    lockedInstanceId,
    kodoModeSelection,
  } = input;
  const realDraftModelState = useComposerDraftModelState(threadRef);
  // KODO: mode-models-composer
  const draftModelState = kodoModeSelection
    ? {
        activeProvider: kodoModeSelection.instanceId,
        modelSelectionByProvider: { [kodoModeSelection.instanceId]: kodoModeSelection },
      }
    : realDraftModelState;
  const providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry> = providerInstanceEntriesFor(
    providerStatuses,
    settings,
    activeProjectId,
  );
  const baseSelection = resolveComposerProviderSelection({
    entries: providerInstanceEntries,
    candidateInstanceIds,
    lockedProvider,
    lockedInstanceId,
  });
  const selection = kodoModeSelection
    ? resolveComposerProviderSelection({
        entries: providerInstanceEntries,
        candidateInstanceIds: [kodoModeSelection.instanceId, ...candidateInstanceIds],
        lockedProvider,
        lockedInstanceId,
      })
    : baseSelection;
  const selectedInstanceId =
    selection.selectedProviderEntry?.instanceId ?? NO_PROVIDER_MODEL_SELECTION.instanceId;
  const selectedProvider: ProviderDriverKind =
    selection.selectedProviderEntry?.driverKind ?? selection.requestedDriverKind;
  const modelState = deriveEffectiveComposerModelState({
    draft: draftModelState,
    providers: providerStatuses,
    selectedProvider,
    selectedInstanceId,
    requestedInstanceId: selection.requestedInstanceId,
    threadModelSelection,
    projectModelSelection,
    settings,
  });
  // KODO: mode-models-composer - what a send carries as the thread's own model while a default is shown.
  const kodoCarried = kodoModeSelection
    ? (() => {
        const instanceId =
          baseSelection.selectedProviderEntry?.instanceId ?? NO_PROVIDER_MODEL_SELECTION.instanceId;
        const driver =
          baseSelection.selectedProviderEntry?.driverKind ?? baseSelection.requestedDriverKind;
        const carriedState = deriveEffectiveComposerModelState({
          draft: realDraftModelState,
          providers: providerStatuses,
          selectedProvider: driver,
          selectedInstanceId: instanceId,
          requestedInstanceId: baseSelection.requestedInstanceId,
          threadModelSelection,
          projectModelSelection,
          settings,
        });
        return {
          instanceId,
          model: carriedState.selectedModel,
          options: carriedState.modelOptions?.[instanceId],
        };
      })()
    : null;
  const selectedProviderModels = selection.selectedProviderEntry?.models ?? NO_PROVIDER_MODELS;
  const composerProviderState = getComposerProviderState({
    provider: selectedProvider,
    model: modelState.selectedModel,
    models: selectedProviderModels,
    promptInjectionState,
    modelOptions: modelState.modelOptions?.[selectedInstanceId],
  });
  return {
    providerInstanceEntries,
    ...selection,
    selectedInstanceId,
    selectedProvider,
    selectedProviderModels,
    composerModelOptions: modelState.modelOptions,
    selectedModel: modelState.selectedModel,
    composerProviderState,
    kodoCarried,
  };
}
