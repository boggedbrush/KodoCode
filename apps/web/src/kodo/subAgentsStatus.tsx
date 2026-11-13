import { createContext, useContext, type ReactNode } from "react";
import type { KodoSubAgentsToggle } from "@t3tools/shared/kodoDelegation";

export interface KodoSubAgentsStatus {
  readonly toggle: KodoSubAgentsToggle;
  /** Turns sub-agents on or off for the thread on screen (or its draft). */
  readonly onToggle: (on: boolean) => void;
}

// The composer's chip reads this instead of taking props through every layer of the controls bar,
// as the mode chip reads its own status; absent where no thread owns a composer.
const KodoSubAgentsStatusContext = createContext<KodoSubAgentsStatus | null>(null);

export function KodoSubAgentsStatusProvider(props: {
  readonly value: KodoSubAgentsStatus;
  readonly children: ReactNode;
}) {
  return (
    <KodoSubAgentsStatusContext.Provider value={props.value}>
      {props.children}
    </KodoSubAgentsStatusContext.Provider>
  );
}

export function useKodoSubAgentsStatus(): KodoSubAgentsStatus | null {
  return useContext(KodoSubAgentsStatusContext);
}
