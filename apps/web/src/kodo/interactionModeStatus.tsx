import { createContext, useContext, type ReactNode } from "react";

interface KodoInteractionModeStatus {
  /** The picked mode differs from the running turn's; the server applies it to the next turn. */
  readonly appliesNextTurn: boolean;
}

const KodoInteractionModeStatusContext = createContext<KodoInteractionModeStatus>({
  appliesNextTurn: false,
});

export function KodoInteractionModeStatusProvider(props: {
  readonly appliesNextTurn: boolean;
  readonly children: ReactNode;
}) {
  return (
    <KodoInteractionModeStatusContext.Provider value={{ appliesNextTurn: props.appliesNextTurn }}>
      {props.children}
    </KodoInteractionModeStatusContext.Provider>
  );
}

export function useKodoInteractionModeStatus(): KodoInteractionModeStatus {
  return useContext(KodoInteractionModeStatusContext);
}
