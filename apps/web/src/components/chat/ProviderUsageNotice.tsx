import { PROVIDER_DISPLAY_NAMES, type ServerProviderUsage } from "@t3tools/contracts";
import { memo } from "react";
import { CircleAlertIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "../ui/alert";

export const ProviderUsageNotice = memo(function ProviderUsageNotice({
  usage,
}: {
  usage: ServerProviderUsage | null;
}) {
  if (!usage || (usage.status !== "limited" && usage.status !== "exhausted")) {
    return null;
  }

  const providerLabel = PROVIDER_DISPLAY_NAMES[usage.provider] ?? usage.provider;
  const title =
    usage.status === "exhausted"
      ? `${providerLabel} usage exhausted`
      : `${providerLabel} usage limited`;
  const message =
    usage.detail ??
    usage.summary ??
    (usage.status === "exhausted"
      ? `${providerLabel} reported no remaining quota.`
      : `${providerLabel} reported reduced remaining quota.`);

  return (
    <div className="pt-2 mx-auto max-w-3xl">
      <Alert variant="warning">
        <CircleAlertIcon />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="line-clamp-3" title={message}>
          {message}
        </AlertDescription>
      </Alert>
    </div>
  );
});
