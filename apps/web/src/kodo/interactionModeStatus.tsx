import { createContext, useContext, type ReactNode } from "react";
import { KodoSubAgentsStatusProvider, type KodoSubAgentsStatus } from "./subAgentsStatus";

interface KodoInteractionModeStatus {
  /** The picked mode differs from the running turn's; the server applies it to the next turn. */
  readonly appliesNextTurn: boolean;
  /** A loop is running and sets the mode itself; the picker does not change it. */
  readonly locked: boolean;
}

const KodoInteractionModeStatusContext = createContext<KodoInteractionModeStatus>({
  appliesNextTurn: false,
  locked: false,
});

export function KodoInteractionModeStatusProvider(props: {
  readonly appliesNextTurn: boolean;
  readonly locked?: boolean;
  /** The sub-agents switch for the same composer, so one wrapper in the chat view serves both chips. */
  readonly subAgents?: KodoSubAgentsStatus;
  readonly children: ReactNode;
}) {
  const children =
    props.subAgents === undefined ? (
      props.children
    ) : (
      <KodoSubAgentsStatusProvider value={props.subAgents}>
        {props.children}
      </KodoSubAgentsStatusProvider>
    );
  return (
    <KodoInteractionModeStatusContext.Provider
      value={{ appliesNextTurn: props.appliesNextTurn, locked: props.locked ?? false }}
    >
      {children}
    </KodoInteractionModeStatusContext.Provider>
  );
}

export function useKodoInteractionModeStatus(): KodoInteractionModeStatus {
  return useContext(KodoInteractionModeStatusContext);
}
