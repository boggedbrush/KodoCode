import { queryOptions } from "@tanstack/react-query";
import type { ProviderStartOptions } from "@t3tools/contracts";
import { ensureNativeApi } from "~/nativeApi";

export const serverQueryKeys = {
  all: ["server"] as const,
  config: () => ["server", "config"] as const,
  usage: (providerOptions: ProviderStartOptions | null) =>
    ["server", "usage", providerOptions] as const,
  worktrees: () => ["server", "worktrees"] as const,
};

export function serverConfigQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.config(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getConfig();
    },
    staleTime: Infinity,
  });
}

export function serverWorktreesQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.worktrees(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.listWorktrees();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function serverUsageQueryOptions(providerOptions: ProviderStartOptions | undefined) {
  return queryOptions({
    queryKey: serverQueryKeys.usage(providerOptions ?? null),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getUsageStatus({
        ...(providerOptions ? { providerOptions } : {}),
      });
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}
