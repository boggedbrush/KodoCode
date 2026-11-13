import { createContext, useContext, type ReactNode } from "react";
import { KodoSubAgentsStatusProvider, type KodoSubAgentsStatus } from "./subAgentsStatus";

interface KodoInteractionModeStatus {
  /** The picked mode differs from the running turn's; the server applies it to the next turn. */
  readonly appliesNextTurn: boolean;
  /** A loop is running and sets the mode itself; the picker does not change it. */
  readonly locked: boolean;
  /** The Orchestrator conversation: its mode is the server's, so no mode chip is shown, and it runs on the Orchestrator model. */
  readonly orchestrator: boolean;
}

const KodoInteractionModeStatusContext = createContext<KodoInteractionModeStatus>({
  appliesNextTurn: false,
  locked: false,
  orchestrator: false,
});

export function KodoInteractionModeStatusProvider(props: {
  readonly appliesNextTurn: boolean;
  readonly locked?: boolean;
  readonly orchestrator?: boolean;
  /** The sub-agents switch for the same composer, so one wrapper in the chat view serves both chips. */
  readonly subAgents?: KodoSubAgentsStatus | undefined;
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
      value={{
        appliesNextTurn: props.appliesNextTurn,
        locked: props.locked ?? false,
        orchestrator: props.orchestrator ?? false,
      }}
    >
      {children}
    </KodoInteractionModeStatusContext.Provider>
  );
}

export function useKodoInteractionModeStatus(): KodoInteractionModeStatus {
  return useContext(KodoInteractionModeStatusContext);
}
