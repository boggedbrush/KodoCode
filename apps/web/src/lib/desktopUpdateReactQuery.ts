import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { DesktopUpdateState } from "@t3tools/contracts";
import { readDesktopBridge, supportsDesktopCapability } from "../desktopRuntime";

export const desktopUpdateQueryKeys = {
  all: ["desktop", "update"] as const,
  state: () => ["desktop", "update", "state"] as const,
};

export const setDesktopUpdateStateQueryData = (
  queryClient: QueryClient,
  state: DesktopUpdateState | null,
) => queryClient.setQueryData(desktopUpdateQueryKeys.state(), state);

export function desktopUpdateStateQueryOptions() {
  return queryOptions({
    queryKey: desktopUpdateQueryKeys.state(),
    queryFn: async () => {
      const bridge = readDesktopBridge();
      if (!bridge || !supportsDesktopCapability("updates")) return null;
      return bridge.getUpdateState();
    },
    staleTime: Infinity,
    refetchOnMount: "always",
  });
}

export function useDesktopUpdateState() {
  const queryClient = useQueryClient();
  const query = useQuery(desktopUpdateStateQueryOptions());

  useEffect(() => {
    const bridge = readDesktopBridge();
    if (!bridge || !supportsDesktopCapability("updates")) return;

    return bridge.onUpdateState((nextState) => {
      setDesktopUpdateStateQueryData(queryClient, nextState);
    });
  }, [queryClient]);

  return query;
}
