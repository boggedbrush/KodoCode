// @effect-diagnostics nodeBuiltinImport:off -- Reads GNOME settings by spawning gsettings and keeps one small preference file.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import type { KodoGnomeAccent, KodoWindowButton, KodoWindowChromeState } from "@t3tools/contracts";
import type * as Electron from "electron";

import { parseGnomeAccent } from "./gnomeAccent.ts";
import { parseGnomeButtonLayout, type GnomeButtonLayout } from "./gnomeButtonLayout.ts";
import { watchLinuxAccentColor } from "./LinuxAccentColor.ts";
import {
  KODO_SYSTEM_ACCENT_CHANNEL,
  KODO_WINDOW_CHROME_CHANNEL,
} from "./kodoLinuxDesktopChannels.ts";

const GSETTINGS_TIMEOUT_MS = 2_000;
const PREFERENCE_FILE = "kodo-window-chrome.json";

/** `gsettings get`, or null when it is missing, fails or does not answer in time. */
async function readGsettings(schema: string, key: string): Promise<string | null> {
  try {
    // Resolved per call: suites that mock node:child_process import this module without defining execFile.
    const { stdout } = await NodeUtil.promisify(NodeChildProcess.execFile)(
      "gsettings",
      ["get", schema, key],
      {
        timeout: GSETTINGS_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: 4_096,
      },
    );
    return stdout;
  } catch {
    return null;
  }
}

export function isGnomeSession(env: NodeJS.ProcessEnv): boolean {
  return (env.XDG_CURRENT_DESKTOP ?? "")
    .split(":")
    .some((desktop) => desktop.trim().toUpperCase() === "GNOME");
}

/** The buttons Kodo draws itself, or null to keep the system frame. */
export function chooseHeaderButtons(input: {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly useSystemTitleBar: boolean;
  readonly layout: GnomeButtonLayout | null;
}): GnomeButtonLayout | null {
  return input.platform === "linux" && isGnomeSession(input.env) && !input.useSystemTitleBar
    ? input.layout
    : null;
}

export class KodoLinuxDesktop {
  private layout: GnomeButtonLayout | null = null;
  private accent: KodoGnomeAccent | null = null;
  private portalAccent = false;
  private refreshing: Promise<void> | null = null;
  private readonly windows = new Map<Electron.BrowserWindow, { readonly custom: boolean }>();

  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private readonly stateDir: string;

  constructor(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, stateDir: string) {
    this.platform = platform;
    this.env = env;
    this.stateDir = stateDir;
  }

  private get preferencePath() {
    return NodePath.join(this.stateDir, PREFERENCE_FILE);
  }

  async getUseSystemTitleBar(): Promise<boolean> {
    try {
      const document: unknown = JSON.parse(await NodeFSP.readFile(this.preferencePath, "utf8"));
      return (document as { useSystemTitleBar?: unknown } | null)?.useSystemTitleBar === true;
    } catch {
      return false;
    }
  }

  async setUseSystemTitleBar(enabled: boolean): Promise<void> {
    const temporary = `${this.preferencePath}.${process.pid}.tmp`;
    await NodeFSP.mkdir(this.stateDir, { recursive: true });
    await NodeFSP.writeFile(temporary, `${JSON.stringify({ useSystemTitleBar: enabled })}\n`);
    await NodeFSP.rename(temporary, this.preferencePath);
  }

  /** Before the main window exists: whether it draws its own header buttons. Reads gsettings once. */
  async prepareFrame(): Promise<boolean> {
    if (this.platform !== "linux" || !isGnomeSession(this.env)) return false;
    const useSystemTitleBar = await this.getUseSystemTitleBar();
    if (useSystemTitleBar) return false;
    const layout = await this.readLayout();
    this.layout = chooseHeaderButtons({
      platform: this.platform,
      env: this.env,
      useSystemTitleBar,
      layout,
    });
    return this.layout !== null;
  }

  private async readLayout(): Promise<GnomeButtonLayout | null> {
    const output = await readGsettings("org.gnome.desktop.wm.preferences", "button-layout");
    return output === null ? null : parseGnomeButtonLayout(output);
  }

  isCustomFrame(window: Electron.BrowserWindow): boolean {
    return this.windows.get(window)?.custom === true;
  }

  chromeState(window: Electron.BrowserWindow): KodoWindowChromeState | null {
    if (!this.isCustomFrame(window) || this.layout === null || window.isDestroyed()) return null;
    return {
      left: this.layout.left,
      right: this.layout.right,
      maximized: window.isMaximized(),
      fullscreen: window.isFullScreen(),
    };
  }

  accentColor(): KodoGnomeAccent | null {
    return this.accent;
  }

  /** Tracks the main window: its state follows maximize and fullscreen, and a focus re-reads GNOME's settings. */
  attach(window: Electron.BrowserWindow, custom: boolean): void {
    this.windows.set(window, { custom });
    window.once("closed", () => this.windows.delete(window));
    window.on("focus", () => void this.refresh());
    if (!custom) return;
    const sendChrome = () => this.sendChrome(window);
    window.on("maximize", sendChrome);
    window.on("unmaximize", sendChrome);
    window.on("enter-full-screen", sendChrome);
    window.on("leave-full-screen", sendChrome);
  }

  private sendChrome(window: Electron.BrowserWindow) {
    const state = this.chromeState(window);
    if (state !== null) window.webContents.send(KODO_WINDOW_CHROME_CHANNEL, state);
  }

  // The layout and the accent change in GNOME Settings, which Electron is not told about; a focus is when it is looked at.
  private refresh(): Promise<void> {
    this.refreshing ??= (async () => {
      try {
        const layout = this.layout === null ? null : await this.readLayout();
        if (layout !== null && JSON.stringify(layout) !== JSON.stringify(this.layout)) {
          this.layout = layout;
          for (const window of this.windows.keys()) this.sendChrome(window);
        }
        if (!this.portalAccent && isGnomeSession(this.env)) {
          const output = await readGsettings("org.gnome.desktop.interface", "accent-color");
          this.setAccent(output === null ? null : parseGnomeAccent(output));
        }
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private setAccent(accent: KodoGnomeAccent | null) {
    if (accent === this.accent) return;
    this.accent = accent;
    for (const window of this.windows.keys()) {
      if (!window.isDestroyed()) window.webContents.send(KODO_SYSTEM_ACCENT_CHANNEL, accent);
    }
  }

  /** Follows the accent through the portal; without one, gsettings answers once now and again on focus. Returns the stop. */
  startAccent(): () => void {
    if (this.platform !== "linux" || !isGnomeSession(this.env)) return () => undefined;
    try {
      const watcher = watchLinuxAccentColor((accent) => {
        this.portalAccent = true;
        this.setAccent(accent);
      });
      void watcher.ready.then((answered) => {
        if (!answered) void this.refresh();
      });
      return watcher.stop;
    } catch {
      void this.refresh();
      return () => undefined;
    }
  }

  runWindowAction(window: Electron.BrowserWindow, action: KodoWindowButton): void {
    if (window.isDestroyed()) return;
    if (action === "minimize") window.minimize();
    else if (action === "close") window.close();
    else if (window.isFullScreen()) window.setFullScreen(false);
    else if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  }
}

let instance: KodoLinuxDesktop | undefined;

/** One per app: the window hook and the IPC handlers share what GNOME last said. */
export function kodoLinuxDesktopFor(environment: {
  readonly platform: NodeJS.Platform;
  readonly stateDir: string;
}): KodoLinuxDesktop {
  instance ??= new KodoLinuxDesktop(environment.platform, process.env, environment.stateDir);
  return instance;
}

/** Whether a window draws Kodo's own header buttons, false before any window was prepared. */
export function isKodoCustomFrame(window: Electron.BrowserWindow): boolean {
  return instance?.isCustomFrame(window) === true;
}
