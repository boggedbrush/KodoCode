import { Undo2Icon } from "lucide-react";
import { type ReactNode } from "react";
import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  type ProviderKind,
  type ProviderModelOptions,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";

import { getCustomModelOptionsByProvider } from "../../modelSelection";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function SettingsSection({
  title,
  icon,
  headerAction,
  children,
}: {
  title: string;
  icon?: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {icon}
          {title}
        </h2>
        {headerAction}
      </div>
      <div className="relative overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-xs/5 not-dark:bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]">
        {children}
      </div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  status,
  resetAction,
  control,
  children,
}: {
  title: ReactNode;
  description: string;
  status?: ReactNode;
  resetAction?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="border-t border-border px-4 py-4 first:border-t-0 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <h3 className="text-sm font-medium text-foreground">{title}</h3>
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
              {resetAction}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{description}</p>
          {status ? <div className="pt-1 text-[11px] text-muted-foreground">{status}</div> : null}
        </div>
        {control ? (
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
            {control}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function ModelSelectionControl({
  provider,
  lockedProvider,
  model,
  modelOptions,
  models,
  modelOptionsByProvider,
  providers,
  fallbackModel,
  onProviderModelChange,
  onModelOptionsChange,
}: {
  provider: ProviderKind;
  lockedProvider?: ProviderKind | null;
  model: string;
  modelOptions: ProviderModelOptions[ProviderKind] | null | undefined;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptionsByProvider: ReturnType<typeof getCustomModelOptionsByProvider>;
  providers: ReadonlyArray<ServerProvider>;
  fallbackModel?: string;
  onProviderModelChange: (provider: ProviderKind, model: string) => void;
  onModelOptionsChange: (nextOptions: ProviderModelOptions[ProviderKind] | undefined) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <ProviderModelPicker
        provider={provider}
        model={model}
        lockedProvider={lockedProvider ?? null}
        providers={providers}
        modelOptionsByProvider={modelOptionsByProvider}
        triggerVariant="outline"
        triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
        onProviderModelChange={onProviderModelChange}
      />
      <TraitsPicker
        provider={provider}
        models={models}
        model={model}
        prompt=""
        onPromptChange={() => {}}
        modelOptions={modelOptions}
        allowPromptInjectedEffort={false}
        triggerVariant="outline"
        triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
        fallbackModel={fallbackModel ?? DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[provider]}
        onModelOptionsChange={onModelOptionsChange}
      />
    </div>
  );
}

export function SettingResetButton({
  label,
  onClick,
  tooltipText,
}: {
  label: string;
  onClick: () => void;
  tooltipText?: string;
}) {
  const actionLabel = tooltipText ?? `Reset ${label} to default`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={actionLabel}
            className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
          >
            <Undo2Icon className="size-3" />
          </Button>
        }
      />
      <TooltipPopup side="top">{tooltipText ?? "Reset to default"}</TooltipPopup>
    </Tooltip>
  );
}

export function SettingsPageContainer({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">{children}</div>
    </div>
  );
}
