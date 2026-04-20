import { createContext, useContext } from "react";

export interface DesktopWindowFrameState {
  readonly hasCustomTitlebar: boolean;
  readonly isMaximized: boolean;
}

const DesktopWindowFrameContext = createContext<DesktopWindowFrameState>({
  hasCustomTitlebar: false,
  isMaximized: false,
});

export function DesktopWindowFrameProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: DesktopWindowFrameState;
}) {
  return (
    <DesktopWindowFrameContext.Provider value={value}>
      {children}
    </DesktopWindowFrameContext.Provider>
  );
}

export function useDesktopWindowFrame(): DesktopWindowFrameState {
  return useContext(DesktopWindowFrameContext);
}
