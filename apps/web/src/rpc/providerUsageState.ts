import { useAtomSubscribe, useAtomValue } from "@effect/atom-react";
import type {
  ProviderKind,
  ServerProviderUsage,
  ServerProviderUsageUpdatedPayload,
  ServerUsageStreamEvent,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useRef } from "react";

import type { WsRpcClient } from "../wsRpcClient";
import { appAtomRegistry } from "./atomRegistry";

interface ProviderUsageUpdatedNotification {
  readonly id: number;
  readonly payload: ServerProviderUsageUpdatedPayload;
  readonly source: ServerUsageStreamEvent["type"];
}

type ProviderUsageStateClient = Pick<
  WsRpcClient["server"],
  "getUsageStatus" | "subscribeUsageStatus"
>;

function makeStateAtom<A>(label: string, initialValue: A) {
  return Atom.make(initialValue).pipe(Atom.keepAlive, Atom.withLabel(label));
}

const EMPTY_PROVIDER_USAGES: ReadonlyArray<ServerProviderUsage> = [];

const providerUsagesAtom = makeStateAtom<ReadonlyArray<ServerProviderUsage> | null>(
  "provider-usages",
  null,
);
const providerUsageUpdatedAtom = makeStateAtom<ProviderUsageUpdatedNotification | null>(
  "provider-usages-updated",
  null,
);

let nextProviderUsageNotificationId = 1;

export function resetProviderUsageStateForTests() {
  appAtomRegistry.set(providerUsagesAtom, null);
  appAtomRegistry.set(providerUsageUpdatedAtom, null);
  nextProviderUsageNotificationId = 1;
}

export function getProviderUsages(): ReadonlyArray<ServerProviderUsage> {
  return appAtomRegistry.get(providerUsagesAtom) ?? EMPTY_PROVIDER_USAGES;
}

export function setProviderUsageSnapshot(usages: ReadonlyArray<ServerProviderUsage>) {
  appAtomRegistry.set(providerUsagesAtom, usages);
  emitProviderUsageUpdated({ usages }, "snapshot");
}

export function applyProviderUsageEvent(event: ServerUsageStreamEvent) {
  if (event.type === "snapshot") {
    setProviderUsageSnapshot(event.usages);
    return;
  }

  appAtomRegistry.set(providerUsagesAtom, event.payload.usages);
  emitProviderUsageUpdated(event.payload, event.type);
}

export function startProviderUsageSync(client: ProviderUsageStateClient): () => void {
  let disposed = false;
  const unsubscribe = client.subscribeUsageStatus((event) => {
    applyProviderUsageEvent(event);
  });

  if (appAtomRegistry.get(providerUsagesAtom) === null) {
    void client
      .getUsageStatus()
      .then((usages) => {
        if (disposed || appAtomRegistry.get(providerUsagesAtom) !== null) {
          return;
        }
        setProviderUsageSnapshot(usages);
      })
      .catch(() => undefined);
  }

  return () => {
    disposed = true;
    unsubscribe();
  };
}

function emitProviderUsageUpdated(
  payload: ServerProviderUsageUpdatedPayload,
  source: ServerUsageStreamEvent["type"],
) {
  appAtomRegistry.set(providerUsageUpdatedAtom, {
    id: nextProviderUsageNotificationId++,
    payload,
    source,
  });
}

function useLatestAtomSubscription<A>(
  atom: Atom.Atom<A | null>,
  listener: (value: NonNullable<A>) => void,
): void {
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  const stableListener = useCallback((value: A | null) => {
    if (value === null) {
      return;
    }
    listenerRef.current(value as NonNullable<A>);
  }, []);

  useAtomSubscribe(atom, stableListener, { immediate: true });
}

export function useProviderUsages(): ReadonlyArray<ServerProviderUsage> {
  return useAtomValue(providerUsagesAtom, (value) => value ?? EMPTY_PROVIDER_USAGES);
}

export function useProviderUsage(provider: ProviderKind): ServerProviderUsage | null {
  return useAtomValue(
    providerUsagesAtom,
    (value) => value?.find((entry) => entry.provider === provider) ?? null,
  );
}

export function useProviderUsageUpdatedSubscription(
  listener: (
    payload: ServerProviderUsageUpdatedPayload,
    source: ServerUsageStreamEvent["type"],
  ) => void,
): void {
  useLatestAtomSubscription(providerUsageUpdatedAtom, (notification) => {
    listener(notification.payload, notification.source);
  });
}
