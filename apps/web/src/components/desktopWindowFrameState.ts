import { createContext, useContext } from "react";

export type DesktopWindowFrameContextValue = {
  hasCustomTitlebar: boolean;
  isMaximized: boolean;
};

export const DesktopWindowFrameContext = createContext<DesktopWindowFrameContextValue>({
  hasCustomTitlebar: false,
  isMaximized: false,
});

export function useDesktopWindowFrame(): DesktopWindowFrameContextValue {
  return useContext(DesktopWindowFrameContext);
}
