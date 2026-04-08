import { createContext, useContext } from "react";

export type DesktopWindowFrameContextValue = {
  isLinuxDesktop: boolean;
  isMaximized: boolean;
};

export const DesktopWindowFrameContext = createContext<DesktopWindowFrameContextValue>({
  isLinuxDesktop: false,
  isMaximized: false,
});

export function useDesktopWindowFrame(): DesktopWindowFrameContextValue {
  return useContext(DesktopWindowFrameContext);
}
