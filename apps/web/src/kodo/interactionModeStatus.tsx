import { createContext, useContext, type ReactNode } from "react";

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
  readonly children: ReactNode;
}) {
  return (
    <KodoInteractionModeStatusContext.Provider
      value={{ appliesNextTurn: props.appliesNextTurn, locked: props.locked ?? false }}
    >
      {props.children}
    </KodoInteractionModeStatusContext.Provider>
  );
}

export function useKodoInteractionModeStatus(): KodoInteractionModeStatus {
  return useContext(KodoInteractionModeStatusContext);
}
