import { useEffect } from "react";

import { useStableCallback } from "../hooks/useStableCallback";
import {
  readUsagePagePreferences,
  saveUsagePagePreferences,
} from "../components/usage/usagePagePreferences";

const requests = new Set<() => void>();

/** Opens Usage on its Limits view, also when Usage is already showing Cost or Tokens. */
export function openKodoUsageLimits(navigate: (options: { to: "/usage" }) => unknown): void {
  saveUsagePagePreferences({ ...readUsagePagePreferences(), metric: "limits" });
  for (const request of requests) request();
  void navigate({ to: "/usage" });
}

/** Lets a mounted Usage page switch to Limits when `/usage`, the palette or the meter ask for it. */
export function useKodoUsageLimitsRequest(showLimits: () => void): void {
  const onRequest = useStableCallback(showLimits);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes the mounted page to open-limits requests from outside React
  useEffect(() => {
    requests.add(onRequest);
    return () => void requests.delete(onRequest);
  }, [onRequest]);
}
