import type { DesktopBridge, KodoGnomeAccent, KodoWindowChromeState } from "@t3tools/contracts";
import type { IpcRenderer } from "electron";

import * as Channels from "./kodoLinuxDesktopChannels.ts";

const listen = <T>(
  ipcRenderer: IpcRenderer,
  channel: string,
  accept: (value: unknown) => value is T,
  listener: (value: T) => void,
) => {
  const wrapped = (_event: Electron.IpcRendererEvent, value: unknown) => {
    if (accept(value)) listener(value);
  };
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
};

const isChromeState = (value: unknown): value is KodoWindowChromeState =>
  typeof value === "object" && value !== null && Array.isArray((value as { left?: unknown }).left);
const isAccent = (value: unknown): value is KodoGnomeAccent | null =>
  value === null || typeof value === "string";

/** The Linux desktop part of the bridge; other platforms expose none, so the web client draws nothing extra. */
export function kodoLinuxDesktopPreload(
  ipcRenderer: IpcRenderer,
  platform: NodeJS.Platform,
): Pick<DesktopBridge, "kodoLinuxDesktop"> {
  if (platform !== "linux") return {};
  return {
    kodoLinuxDesktop: {
      getWindowChrome: () => {
        const state: unknown = ipcRenderer.sendSync(Channels.KODO_GET_WINDOW_CHROME_CHANNEL);
        return isChromeState(state) ? state : null;
      },
      onWindowChrome: (listener) =>
        listen(ipcRenderer, Channels.KODO_WINDOW_CHROME_CHANNEL, isChromeState, listener),
      runWindowAction: (action) => ipcRenderer.invoke(Channels.KODO_WINDOW_ACTION_CHANNEL, action),
      getUseSystemTitleBar: async () =>
        (await ipcRenderer.invoke(Channels.KODO_GET_USE_SYSTEM_TITLE_BAR_CHANNEL)) === true,
      setUseSystemTitleBar: (enabled) =>
        ipcRenderer.invoke(Channels.KODO_SET_USE_SYSTEM_TITLE_BAR_CHANNEL, enabled),
      getSystemAccent: () => {
        const accent: unknown = ipcRenderer.sendSync(Channels.KODO_GET_SYSTEM_ACCENT_CHANNEL);
        return isAccent(accent) ? accent : null;
      },
      onSystemAccent: (listener) =>
        listen(ipcRenderer, Channels.KODO_SYSTEM_ACCENT_CHANNEL, isAccent, listener),
    },
  };
}
