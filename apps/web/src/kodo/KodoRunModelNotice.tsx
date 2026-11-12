import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ModelSelection, OrchestrationV2Run } from "@t3tools/contracts";
import { InfoIcon } from "lucide-react";

import { getTriggerDisplayModelName } from "../components/chat/providerIconUtils";
import { TimelineSystemDivider } from "../components/chat/TimelineSystemDivider";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../state/server";
import { kodoRunModelNotice } from "./modeModels.logic";

/**
 * Said above a message whose run could not use the mode's default model: which model ran, which was
 * wanted and why not. The composer predicts this from what the client can see; the server also
 * falls back for reasons it cannot (a refused provider switch, background work), so this is the record.
 */
export function KodoRunModelNotice(props: {
  readonly environmentId: EnvironmentId;
  readonly run: Pick<OrchestrationV2Run, "modelSelection" | "kodoModel"> | undefined;
}) {
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(props.environmentId)) ??
    EMPTY_SERVER_PROVIDERS;
  if (props.run?.kodoModel?.unavailable === undefined) return null;
  const modelName = (selection: ModelSelection) => {
    const provider = providers.find((entry) => entry.instanceId === selection.instanceId);
    const model = provider?.models.find((entry) => entry.slug === selection.model);
    return model ? getTriggerDisplayModelName(model, provider?.driver) : selection.model;
  };
  const notice = kodoRunModelNotice(props.run, modelName, (instanceId) => {
    const provider = providers.find((entry) => entry.instanceId === instanceId);
    return provider?.displayName ?? instanceId;
  });
  if (notice === null) return null;
  return (
    <div data-kodo-run-model-notice>
      <TimelineSystemDivider
        label={notice.label}
        detail={notice.detail}
        icon={InfoIcon}
        wrapDetail
      />
    </div>
  );
}
