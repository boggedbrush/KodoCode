import type { KodoInteractionMode } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../lib/storage";
import { advanceKodoPlanEpoch, type KodoPlanEpoch } from "./planAccept.logic";

const MAX_TRACKED_THREADS = 500;

interface KodoPlanEpochStoreState {
  readonly epochByThreadKey: Readonly<Record<string, KodoPlanEpoch>>;
  /** Record the mode the thread is in and the newest run number, at the moment it is known. */
  readonly observe: (
    threadKey: string,
    observed: { readonly mode: KodoInteractionMode; readonly latestRunOrdinal: number },
  ) => void;
}

/** Where each thread last entered Plan, kept across reloads (see `advanceKodoPlanEpoch`). */
export const useKodoPlanEpochStore = create<KodoPlanEpochStoreState>()(
  persist(
    (set) => ({
      epochByThreadKey: {},
      observe: (threadKey, observed) =>
        set((state) => {
          const previous = state.epochByThreadKey[threadKey];
          const next = advanceKodoPlanEpoch(previous, observed);
          if (next === previous) return state;
          const { [threadKey]: _replaced, ...rest } = state.epochByThreadKey;
          const entries = Object.entries({ ...rest, [threadKey]: next });
          return { epochByThreadKey: Object.fromEntries(entries.slice(-MAX_TRACKED_THREADS)) };
        }),
    }),
    {
      name: "kodo:plan-epoch:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      version: 1,
      partialize: (state) => ({ epochByThreadKey: state.epochByThreadKey }),
    },
  ),
);
