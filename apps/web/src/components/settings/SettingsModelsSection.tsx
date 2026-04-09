import { DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER } from "@t3tools/contracts";
import { type UnifiedSettings } from "@t3tools/contracts/settings";

import { useServerProviders } from "../../rpc/serverState";
import {
  getCustomModelOptionsByProvider,
  resolveModeModelSelectionState,
} from "../../modelSelection";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { SettingResetButton, SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";

type SettingsUpdater = (patch: Partial<UnifiedSettings>) => void;

export function SettingsModelsSection({
  settings,
  updateSettings,
}: {
  settings: UnifiedSettings;
  updateSettings: SettingsUpdater;
}) {
  const serverProviders = useServerProviders();

  const askSelection = settings.askModelSelection;
  const askProvider = askSelection?.provider ?? "codex";
  const askModel = askSelection?.model ?? "";
  const askModelOptions = askSelection?.options;
  const askModelOptionsByProvider = getCustomModelOptionsByProvider(
    settings,
    serverProviders,
    askProvider,
    askModel || undefined,
  );
  const isAskModelDirty = askSelection !== null && askSelection !== undefined;

  const planSelection = settings.planModelSelection;
  const planProvider = planSelection?.provider ?? "codex";
  const planModel = planSelection?.model ?? "";
  const planModelOptions = planSelection?.options;
  const planModelOptionsByProvider = getCustomModelOptionsByProvider(
    settings,
    serverProviders,
    planProvider,
    planModel || undefined,
  );
  const isPlanModelDirty = planSelection !== null && planSelection !== undefined;

  const codeSelection = settings.codeModelSelection;
  const codeProvider = codeSelection?.provider ?? "codex";
  const codeModel = codeSelection?.model ?? "";
  const codeModelOptions = codeSelection?.options;
  const codeModelOptionsByProvider = getCustomModelOptionsByProvider(
    settings,
    serverProviders,
    codeProvider,
    codeModel || undefined,
  );
  const isCodeModelDirty = codeSelection !== null && codeSelection !== undefined;

  const reviewSelection = settings.reviewModelSelection;
  const reviewProvider = reviewSelection?.provider ?? "codex";
  const reviewModel = reviewSelection?.model ?? "";
  const reviewModelOptions = reviewSelection?.options;
  const reviewModelOptionsByProvider = getCustomModelOptionsByProvider(
    settings,
    serverProviders,
    reviewProvider,
    reviewModel || undefined,
  );
  const isReviewModelDirty = reviewSelection !== null && reviewSelection !== undefined;

  return (
    <SettingsSection title="Models">
      <SettingsRow
        title="Ask mode model"
        description="Model and reasoning level used when in Ask mode. Leave unset to use the default model."
        resetAction={
          isAskModelDirty ? (
            <SettingResetButton
              label="ask model"
              onClick={() => updateSettings({ askModelSelection: null })}
            />
          ) : null
        }
        control={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <ProviderModelPicker
              provider={askProvider}
              model={askModel}
              lockedProvider={null}
              providers={serverProviders}
              modelOptionsByProvider={askModelOptionsByProvider}
              triggerVariant="outline"
              triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
              onProviderModelChange={(provider, model) => {
                updateSettings({
                  askModelSelection: resolveModeModelSelectionState(
                    { provider, model },
                    settings,
                    serverProviders,
                  ),
                });
              }}
            />
            <TraitsPicker
              provider={askProvider}
              models={serverProviders.find((p) => p.provider === askProvider)?.models ?? []}
              model={askModel}
              prompt=""
              onPromptChange={() => {}}
              modelOptions={askModelOptions}
              allowPromptInjectedEffort={false}
              triggerVariant="outline"
              triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
              fallbackModel={DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[askProvider]}
              onModelOptionsChange={(nextOptions) => {
                updateSettings({
                  askModelSelection: resolveModeModelSelectionState(
                    {
                      provider: askProvider,
                      model: askModel || "gpt-5.4",
                      ...(nextOptions ? { options: nextOptions } : {}),
                    },
                    settings,
                    serverProviders,
                  ),
                });
              }}
            />
          </div>
        }
      />

      <SettingsRow
        title="Plan mode model"
        description="Model and reasoning level used when in Plan mode. Leave unset to use the default model."
        resetAction={
          isPlanModelDirty ? (
            <SettingResetButton
              label="plan model"
              onClick={() => updateSettings({ planModelSelection: null })}
            />
          ) : null
        }
        control={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <ProviderModelPicker
              provider={planProvider}
              model={planModel}
              lockedProvider={null}
              providers={serverProviders}
              modelOptionsByProvider={planModelOptionsByProvider}
              triggerVariant="outline"
              triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
              onProviderModelChange={(provider, model) => {
                updateSettings({
                  planModelSelection: resolveModeModelSelectionState(
                    { provider, model },
                    settings,
                    serverProviders,
                  ),
                });
              }}
            />
            <TraitsPicker
              provider={planProvider}
              models={serverProviders.find((p) => p.provider === planProvider)?.models ?? []}
              model={planModel}
              prompt=""
              onPromptChange={() => {}}
              modelOptions={planModelOptions}
              allowPromptInjectedEffort={false}
              triggerVariant="outline"
              triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
              fallbackModel={DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[planProvider]}
              onModelOptionsChange={(nextOptions) => {
                updateSettings({
                  planModelSelection: resolveModeModelSelectionState(
                    {
                      provider: planProvider,
                      model: planModel || "gpt-5.4",
                      ...(nextOptions ? { options: nextOptions } : {}),
                    },
                    settings,
                    serverProviders,
                  ),
                });
              }}
            />
          </div>
        }
      />

      <SettingsRow
        title="Code mode model"
        description="Model and reasoning level used when in Code mode. Leave unset to use the default model."
        resetAction={
          isCodeModelDirty ? (
            <SettingResetButton
              label="code model"
              onClick={() => updateSettings({ codeModelSelection: null })}
            />
          ) : null
        }
        control={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <ProviderModelPicker
              provider={codeProvider}
              model={codeModel}
              lockedProvider={null}
              providers={serverProviders}
              modelOptionsByProvider={codeModelOptionsByProvider}
              triggerVariant="outline"
              triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
              onProviderModelChange={(provider, model) => {
                updateSettings({
                  codeModelSelection: resolveModeModelSelectionState(
                    { provider, model },
                    settings,
                    serverProviders,
                  ),
                });
              }}
            />
            <TraitsPicker
              provider={codeProvider}
              models={serverProviders.find((p) => p.provider === codeProvider)?.models ?? []}
              model={codeModel}
              prompt=""
              onPromptChange={() => {}}
              modelOptions={codeModelOptions}
              allowPromptInjectedEffort={false}
              triggerVariant="outline"
              triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
              fallbackModel={DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[codeProvider]}
              onModelOptionsChange={(nextOptions) => {
                updateSettings({
                  codeModelSelection: resolveModeModelSelectionState(
                    {
                      provider: codeProvider,
                      model: codeModel || "gpt-5.4",
                      ...(nextOptions ? { options: nextOptions } : {}),
                    },
                    settings,
                    serverProviders,
                  ),
                });
              }}
            />
          </div>
        }
      />

      <SettingsRow
        title="Review mode model"
        description="Model and reasoning level used when in Review mode. Leave unset to use the default model."
        resetAction={
          isReviewModelDirty ? (
            <SettingResetButton
              label="review model"
              onClick={() => updateSettings({ reviewModelSelection: null })}
            />
          ) : null
        }
        control={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <ProviderModelPicker
              provider={reviewProvider}
              model={reviewModel}
              lockedProvider={null}
              providers={serverProviders}
              modelOptionsByProvider={reviewModelOptionsByProvider}
              triggerVariant="outline"
              triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
              onProviderModelChange={(provider, model) => {
                updateSettings({
                  reviewModelSelection: resolveModeModelSelectionState(
                    { provider, model },
                    settings,
                    serverProviders,
                  ),
                });
              }}
            />
            <TraitsPicker
              provider={reviewProvider}
              models={serverProviders.find((p) => p.provider === reviewProvider)?.models ?? []}
              model={reviewModel}
              prompt=""
              onPromptChange={() => {}}
              modelOptions={reviewModelOptions}
              allowPromptInjectedEffort={false}
              triggerVariant="outline"
              triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
              fallbackModel={DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[reviewProvider]}
              onModelOptionsChange={(nextOptions) => {
                updateSettings({
                  reviewModelSelection: resolveModeModelSelectionState(
                    {
                      provider: reviewProvider,
                      model: reviewModel || "gpt-5.4",
                      ...(nextOptions ? { options: nextOptions } : {}),
                    },
                    settings,
                    serverProviders,
                  ),
                });
              }}
            />
          </div>
        }
      />
    </SettingsSection>
  );
}
