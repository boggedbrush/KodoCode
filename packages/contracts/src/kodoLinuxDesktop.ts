// Kodo's GNOME depth on the Linux desktop app: the header bar's window buttons and the system accent
// colour, as the Electron main process reports them to the web client over the desktop bridge.
// The main process reads them from GNOME; apps/desktop/src/kodo holds the rules.
import * as Schema from "effect/Schema";

export const KodoWindowButton = Schema.Literals(["minimize", "maximize", "close"]);
export type KodoWindowButton = typeof KodoWindowButton.Type;

/** Which buttons the header bar draws on each side, in GNOME's order, and what the window is doing. */
export const KodoWindowChromeState = Schema.Struct({
  left: Schema.Array(KodoWindowButton),
  right: Schema.Array(KodoWindowButton),
  maximized: Schema.Boolean,
  fullscreen: Schema.Boolean,
});
export type KodoWindowChromeState = typeof KodoWindowChromeState.Type;

/** GNOME's accent colours, as `org.gnome.desktop.interface accent-color` names them, with each one's fill. */
export const KODO_GNOME_ACCENT_COLORS = {
  blue: "#3584e4",
  teal: "#2190a4",
  green: "#3a944a",
  yellow: "#c88800",
  orange: "#ed5b00",
  red: "#e62d42",
  pink: "#d56199",
  purple: "#9141ac",
  slate: "#6f8396",
} as const;
export type KodoGnomeAccent = keyof typeof KODO_GNOME_ACCENT_COLORS;
export const KodoGnomeAccent = Schema.Literals(
  Object.keys(KODO_GNOME_ACCENT_COLORS) as [KodoGnomeAccent, ...KodoGnomeAccent[]],
);

/** The desktop bridge's Kodo part. Present only on the Linux desktop app. */
export interface KodoLinuxDesktopBridge {
  /** Null while the window uses the system frame. */
  readonly getWindowChrome: () => KodoWindowChromeState | null;
  readonly onWindowChrome: (listener: (state: KodoWindowChromeState) => void) => () => void;
  /** Maximize toggles; from fullscreen it leaves fullscreen. */
  readonly runWindowAction: (action: KodoWindowButton) => Promise<void>;
  readonly getUseSystemTitleBar: () => Promise<boolean>;
  /** Takes effect the next time the app starts: a window's frame cannot change once it exists. */
  readonly setUseSystemTitleBar: (enabled: boolean) => Promise<void>;
  /** Null when the desktop does not report an accent colour. */
  readonly getSystemAccent: () => KodoGnomeAccent | null;
  readonly onSystemAccent: (listener: (accent: KodoGnomeAccent | null) => void) => () => void;
}
