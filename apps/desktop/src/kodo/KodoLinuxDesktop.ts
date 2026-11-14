// @effect-diagnostics nodeBuiltinImport:off -- Reads GNOME settings by spawning gsettings and keeps one small preference file.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import type { KodoGnomeAccent, KodoWindowButton, KodoWindowChromeState } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type * as Electron from "electron";

import { parseGnomeAccent } from "./gnomeAccent.ts";
import { parseGnomeButtonLayout, type GnomeButtonLayout } from "./gnomeButtonLayout.ts";
import {
  watchLinuxDesktopSettings,
  type LinuxDesktopSettingsHandlers,
} from "./LinuxDesktopSettings.ts";
import { leaseSessionBus } from "./SessionBusLease.ts";
import {
  KODO_SYSTEM_ACCENT_CHANNEL,
  KODO_WINDOW_CHROME_CHANNEL,
} from "./kodoLinuxDesktopChannels.ts";

const GSETTINGS_TIMEOUT_MS = 2_000;
// Everything read in front of the first window (portal, then gsettings) shares this one budget,
// so a slow desktop delays the window by at most the gsettings timeout and then gets the upstream frame.
const FRAME_BUDGET = Duration.millis(GSETTINGS_TIMEOUT_MS);
// How long a focus waits for the portal's first answer before asking gsettings instead.
const PORTAL_WAIT = Duration.millis(GSETTINGS_TIMEOUT_MS);
// A focus asks gsettings again no sooner than this; the settings rarely change and the portal reports them when it can.
const REFRESH_MIN_INTERVAL_MS = 30_000;
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

// Desktops that list GNOME among their names but are not the GNOME Shell session whose
// button layout and accent colour this reads.
const NOT_GNOME_SHELL = new Set(["BUDGIE", "GNOME-FLASHBACK", "PANTHEON", "UNITY", "X-CINNAMON"]);

/** `XDG_CURRENT_DESKTOP` is a colon-separated list: `GNOME`, `ubuntu:GNOME`, `GNOME-Classic:GNOME`. */
export function isGnomeSession(env: NodeJS.ProcessEnv): boolean {
  const desktops = (env.XDG_CURRENT_DESKTOP ?? "")
    .split(":")
    .map((desktop) => desktop.trim().toUpperCase());
  return desktops.includes("GNOME") && !desktops.some((desktop) => NOT_GNOME_SHELL.has(desktop));
}

/**
 * kodo: no frame and no overlay; the page draws the buttons GNOME's layout asks for.
 * system: the window manager's own frame.
 * upstream: what the window got before Kodo (macOS and Windows controls, Chromium's overlay buttons on Linux).
 */
export type KodoWindowFrame = "kodo" | "system" | "upstream";

export function chooseWindowFrame(input: {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly useSystemTitleBar: boolean;
  readonly layout: GnomeButtonLayout | null;
}): KodoWindowFrame {
  if (input.platform !== "linux") return "upstream";
  if (input.useSystemTitleBar) return "system";
  return isGnomeSession(input.env) && input.layout !== null ? "kodo" : "upstream";
}

// Written beside the file under a name no other write shares, then renamed over it, so a reader never sees half a file.
async function writePreference(directory: string, file: string, enabled: boolean): Promise<void> {
  const temporary = `${file}.${NodeCrypto.randomUUID()}.tmp`;
  await NodeFSP.mkdir(directory, { recursive: true });
  try {
    await NodeFSP.writeFile(temporary, `${JSON.stringify({ useSystemTitleBar: enabled })}\n`);
    await NodeFSP.rename(temporary, file);
  } catch (cause) {
    await NodeFSP.rm(temporary, { force: true });
    throw cause;
  }
}

export class KodoPreferenceWriteError extends Schema.TaggedError<KodoPreferenceWriteError>()(
  "KodoPreferenceWriteError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The title bar setting could not be saved.";
  }
}

export interface KodoLinuxDesktopDependencies {
  readonly readGsettings: (schema: string, key: string) => Promise<string | null>;
  readonly watchPortal: (handlers: LinuxDesktopSettingsHandlers) => {
    readonly ready: Promise<unknown>;
    readonly stop: () => void;
  };
}

const defaultDependencies: KodoLinuxDesktopDependencies = {
  readGsettings,
  watchPortal: (handlers) => watchLinuxDesktopSettings(handlers, leaseSessionBus()),
};

/** What a window's owner gives the window's Kodo part: a way to run effects and to ask the person something. */
export interface KodoWindowHost {
  readonly run: (effect: Effect.Effect<void>) => unknown;
  readonly showMessageBox: (
    window: Electron.BrowserWindow,
    options: Electron.MessageBoxOptions,
  ) => Promise<Electron.MessageBoxReturnValue>;
}

export type KodoWindowUnavailable = "gone" | "unresponsive";

// The page draws the window buttons, so a window whose page is gone has none. The dialog is the
// system's own, with its own title bar. Electron cannot turn Chromium's overlay buttons on for an
// existing window, so closing and reloading are what it can offer.
export function unavailableChoices(kind: KodoWindowUnavailable): {
  readonly buttons: ReadonlyArray<string>;
  readonly actions: ReadonlyArray<"wait" | "reload" | "close">;
} {
  return kind === "unresponsive"
    ? {
        buttons: ["Keep waiting", "Reload", "Close window"],
        actions: ["wait", "reload", "close"],
      }
    : { buttons: ["Reload", "Close window"], actions: ["reload", "close"] };
}

interface TrackedWindow {
  readonly frame: KodoWindowFrame;
  readonly host: KodoWindowHost;
}

export class KodoLinuxDesktop {
  private layout: GnomeButtonLayout | null = null;
  private accent: KodoGnomeAccent | null = null;
  private portalAnsweredLayout = false;
  private portalAnsweredAccent = false;
  private portal: ReturnType<KodoLinuxDesktopDependencies["watchPortal"]> | null = null;
  private refreshing = false;
  private lastRefreshAt: number | null = null;
  private readonly windows = new Map<Electron.BrowserWindow, TrackedWindow>();
  private readonly unavailableDialogs = new Set<Electron.BrowserWindow>();

  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private readonly stateDir: string;
  private readonly dependencies: KodoLinuxDesktopDependencies;

  constructor(
    platform: NodeJS.Platform,
    env: NodeJS.ProcessEnv,
    stateDir: string,
    dependencies: KodoLinuxDesktopDependencies = defaultDependencies,
  ) {
    this.platform = platform;
    this.env = env;
    this.stateDir = stateDir;
    this.dependencies = dependencies;
  }

  private get preferencePath() {
    return NodePath.join(this.stateDir, PREFERENCE_FILE);
  }

  private get gnome() {
    return this.platform === "linux" && isGnomeSession(this.env);
  }

  async getUseSystemTitleBar(): Promise<boolean> {
    try {
      const document: unknown = JSON.parse(await NodeFSP.readFile(this.preferencePath, "utf8"));
      return (document as { useSystemTitleBar?: unknown } | null)?.useSystemTitleBar === true;
    } catch {
      return false;
    }
  }

  setUseSystemTitleBar(enabled: boolean): Effect.Effect<void, KodoPreferenceWriteError> {
    return Effect.tryPromise({
      try: () => writePreference(this.stateDir, this.preferencePath, enabled),
      catch: (cause) => new KodoPreferenceWriteError({ cause }),
    }).pipe(Effect.withSpan("KodoLinuxDesktop.setUseSystemTitleBar"));
  }

  /** Before the main window exists: which frame it gets. On GNOME, reads the button layout within one budget. */
  prepareFrame(): Effect.Effect<KodoWindowFrame> {
    return Effect.gen({ self: this }, function* () {
      if (this.platform !== "linux") return "upstream";
      const useSystemTitleBar = yield* Effect.promise(() => this.getUseSystemTitleBar());
      if (useSystemTitleBar) return "system";
      if (!this.gnome) return "upstream";
      yield* this.readLayout();
      return chooseWindowFrame({
        platform: this.platform,
        env: this.env,
        useSystemTitleBar,
        layout: this.layout,
      });
    }).pipe(
      Effect.timeoutOption(FRAME_BUDGET),
      Effect.map(Option.getOrElse((): KodoWindowFrame => "upstream")),
      Effect.withSpan("KodoLinuxDesktop.prepareFrame"),
    );
  }

  private startPortal() {
    if (this.portal === null) {
      try {
        this.portal = this.dependencies.watchPortal({
          onAccent: (accent) => {
            this.portalAnsweredAccent = true;
            this.setAccent(accent);
          },
          onButtonLayout: (layout) => {
            this.portalAnsweredLayout = true;
            this.setLayout(layout);
          },
        });
      } catch {
        this.portal = { ready: Promise.resolve(), stop: () => undefined };
      }
    }
    return this.portal;
  }

  private stopPortal() {
    this.portal?.stop();
    this.portal = null;
  }

  // The portal first; gsettings only for a layout it did not give.
  private readLayout(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      yield* Effect.promise(() => this.startPortal().ready);
      if (this.portalAnsweredLayout) return;
      yield* this.readLayoutFromGsettings();
    });
  }

  private readLayoutFromGsettings(): Effect.Effect<void> {
    return Effect.promise(async () => {
      const output = await this.dependencies.readGsettings(
        "org.gnome.desktop.wm.preferences",
        "button-layout",
      );
      const layout = output === null ? null : parseGnomeButtonLayout(output);
      if (layout !== null) this.setLayout(layout);
    });
  }

  private readAccentFromGsettings(): Effect.Effect<void> {
    return Effect.promise(async () => {
      const output = await this.dependencies.readGsettings(
        "org.gnome.desktop.interface",
        "accent-color",
      );
      this.setAccent(output === null ? null : parseGnomeAccent(output));
    });
  }

  isCustomFrame(window: Electron.BrowserWindow): boolean {
    return this.windows.get(window)?.frame === "kodo";
  }

  /** Whether the window was created without Chromium's overlay buttons, so there is no overlay to recolor. */
  hasNoOverlay(window: Electron.BrowserWindow): boolean {
    const frame = this.windows.get(window)?.frame;
    return frame === "kodo" || frame === "system";
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
  attach(window: Electron.BrowserWindow, frame: KodoWindowFrame, host: KodoWindowHost): void {
    this.windows.set(window, { frame, host });
    window.once("closed", () => {
      this.windows.delete(window);
      this.unavailableDialogs.delete(window);
    });
    window.on("focus", () => host.run(this.refresh()));
    if (frame !== "kodo") return;
    const sendChrome = () => this.sendChrome(window);
    window.on("maximize", sendChrome);
    window.on("unmaximize", sendChrome);
    window.on("enter-full-screen", sendChrome);
    window.on("leave-full-screen", sendChrome);
    window.on("unresponsive", () => this.reportUnavailable(window, "unresponsive"));
  }

  private sendChrome(window: Electron.BrowserWindow) {
    const state = this.chromeState(window);
    if (state !== null && !window.webContents.isDestroyed()) {
      window.webContents.send(KODO_WINDOW_CHROME_CHANNEL, state);
    }
  }

  private setLayout(layout: GnomeButtonLayout) {
    if (JSON.stringify(layout) === JSON.stringify(this.layout)) return;
    this.layout = layout;
    for (const window of this.windows.keys()) this.sendChrome(window);
  }

  private setAccent(accent: KodoGnomeAccent | null) {
    if (accent === this.accent) return;
    this.accent = accent;
    for (const window of this.windows.keys()) {
      if (!window.isDestroyed()) window.webContents.send(KODO_SYSTEM_ACCENT_CHANNEL, accent);
    }
  }

  /**
   * The layout and the accent change in GNOME Settings. The portal says so when it has them; for what it lacks,
   * a focus is when it is looked at, at most once per interval and never twice at once.
   */
  refresh(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (!this.gnome) return;
      yield* Effect.promise(() => this.startPortal().ready).pipe(Effect.timeoutOption(PORTAL_WAIT));
      const needLayout =
        !this.portalAnsweredLayout &&
        [...this.windows.values()].some((tracked) => tracked.frame === "kodo");
      const needAccent = !this.portalAnsweredAccent;
      if (!needLayout && !needAccent) return;
      const now = yield* Clock.currentTimeMillis;
      if (
        this.refreshing ||
        (this.lastRefreshAt !== null && now - this.lastRefreshAt < REFRESH_MIN_INTERVAL_MS)
      ) {
        return;
      }
      this.refreshing = true;
      this.lastRefreshAt = now;
      yield* Effect.gen({ self: this }, function* () {
        if (needLayout) yield* this.readLayoutFromGsettings();
        if (needAccent) yield* this.readAccentFromGsettings();
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.refreshing = false;
          }),
        ),
      );
    }).pipe(Effect.withSpan("KodoLinuxDesktop.refresh"));
  }

  /** Follows the portal for the accent and the layout; what it cannot give is read from gsettings. Releases the portal. */
  start(): Effect.Effect<void, never, Scope.Scope> {
    return Effect.gen({ self: this }, function* () {
      if (!this.gnome) return;
      yield* Effect.acquireRelease(
        Effect.sync(() => this.startPortal()),
        () => Effect.sync(() => this.stopPortal()),
      );
      yield* this.refresh().pipe(Effect.forkScoped);
    });
  }

  /** A window whose page cannot draw its buttons: offer what a person needs to get out of it. */
  reportUnavailable(window: Electron.BrowserWindow, kind: KodoWindowUnavailable): void {
    const tracked = this.windows.get(window);
    if (tracked?.frame !== "kodo" || window.isDestroyed() || this.unavailableDialogs.has(window)) {
      return;
    }
    this.unavailableDialogs.add(window);
    const { buttons, actions } = unavailableChoices(kind);
    void tracked.host
      .showMessageBox(window, {
        type: "error",
        title: "Kodo Code",
        message:
          kind === "unresponsive"
            ? "Kodo Code is not responding"
            : "Kodo Code could not show its window",
        detail:
          "The window's buttons are drawn by the page, which is not available. You can reload it or close the window.",
        buttons: [...buttons],
        defaultId: 0,
        cancelId: buttons.length - 1,
        noLink: true,
      })
      .then(
        ({ response }) => {
          this.unavailableDialogs.delete(window);
          if (window.isDestroyed()) return;
          const action = actions[response];
          if (action === "reload") window.webContents.reload();
          else if (action === "close") window.close();
        },
        () => this.unavailableDialogs.delete(window),
      );
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

/** Whether a window was created without Chromium's overlay, so its colours have no overlay to follow. */
export function kodoWindowHasNoOverlay(window: Electron.BrowserWindow): boolean {
  return instance?.hasNoOverlay(window) === true;
}
