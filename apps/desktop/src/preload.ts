import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "@t3tools/contracts";

const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
const CONFIRM_CHANNEL = "desktop:confirm";
const SET_THEME_CHANNEL = "desktop:set-theme";
const CONTEXT_MENU_CHANNEL = "desktop:context-menu";
const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";
const MENU_ACTION_CHANNEL = "desktop:menu-action";
const UPDATE_STATE_CHANNEL = "desktop:update-state";
const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
const UPDATE_CHECK_CHANNEL = "desktop:update-check";
const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
const UPDATE_INSTALL_CHANNEL = "desktop:update-install";
const GET_BOOTSTRAP_CHANNEL = "desktop:get-bootstrap";
const WINDOW_MINIMIZE_CHANNEL = "desktop:window-minimize";
const WINDOW_TOGGLE_MAXIMIZE_CHANNEL = "desktop:window-toggle-maximize";
const WINDOW_CLOSE_CHANNEL = "desktop:window-close";
const WINDOW_IS_MAXIMIZED_CHANNEL = "desktop:window-is-maximized";
const WINDOW_MAXIMIZED_CHANGE_CHANNEL = "desktop:window-maximized-change";
const BENCHMARK_STATE_CHANNEL = "desktop:benchmark-state";
const BENCHMARK_GET_STATE_CHANNEL = "desktop:benchmark-get-state";
const BENCHMARK_MARK_MILESTONE_CHANNEL = "desktop:benchmark-mark-milestone";
const BENCHMARK_MARK_EVENT_CHANNEL = "desktop:benchmark-mark-event";
const BENCHMARK_COMPLETE_CHANNEL = "desktop:benchmark-complete";

const bootstrap = ipcRenderer.sendSync(GET_BOOTSTRAP_CHANNEL) as DesktopBridge["bootstrap"];

contextBridge.exposeInMainWorld("desktopBridge", {
  bootstrap,
  pickFolder: () => ipcRenderer.invoke(PICK_FOLDER_CHANNEL),
  confirm: (message) => ipcRenderer.invoke(CONFIRM_CHANNEL, message),
  setTheme: (theme, options) => ipcRenderer.invoke(SET_THEME_CHANNEL, theme, options),
  showContextMenu: (items, position) => ipcRenderer.invoke(CONTEXT_MENU_CHANNEL, items, position),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
  onMenuAction: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };

    ipcRenderer.on(MENU_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(MENU_ACTION_CHANNEL, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL),
  checkForUpdate: () => ipcRenderer.invoke(UPDATE_CHECK_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL),
  onUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },
  windowControls: {
    minimize: () => ipcRenderer.send(WINDOW_MINIMIZE_CHANNEL),
    toggleMaximize: () => ipcRenderer.send(WINDOW_TOGGLE_MAXIMIZE_CHANNEL),
    close: () => ipcRenderer.send(WINDOW_CLOSE_CHANNEL),
    isMaximized: () => ipcRenderer.invoke(WINDOW_IS_MAXIMIZED_CHANNEL) as Promise<boolean>,
    onMaximizedChange: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, isMaximized: unknown) => {
        if (typeof isMaximized === "boolean") listener(isMaximized);
      };
      ipcRenderer.on(WINDOW_MAXIMIZED_CHANGE_CHANNEL, wrappedListener);
      return () => {
        ipcRenderer.removeListener(WINDOW_MAXIMIZED_CHANGE_CHANNEL, wrappedListener);
      };
    },
  },
  benchmark: {
    getState: () => ipcRenderer.invoke(BENCHMARK_GET_STATE_CHANNEL),
    onState: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
        if (typeof state !== "object" || state === null) return;
        listener(state as Parameters<typeof listener>[0]);
      };

      ipcRenderer.on(BENCHMARK_STATE_CHANNEL, wrappedListener);
      return () => {
        ipcRenderer.removeListener(BENCHMARK_STATE_CHANNEL, wrappedListener);
      };
    },
    markMilestone: (milestone) => ipcRenderer.invoke(BENCHMARK_MARK_MILESTONE_CHANNEL, milestone),
    markEvent: (name, detail) => ipcRenderer.invoke(BENCHMARK_MARK_EVENT_CHANNEL, name, detail),
    complete: (result) => ipcRenderer.invoke(BENCHMARK_COMPLETE_CHANNEL, result),
  },
} satisfies DesktopBridge);
