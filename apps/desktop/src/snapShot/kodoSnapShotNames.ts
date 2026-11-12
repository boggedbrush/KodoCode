import { APP_BASE_NAME, APP_ID, APP_PACKAGE_NAME } from "@t3tools/shared/appBrand";

/**
 * Linux SnapShot names this distribution owns, so it installs beside upstream's app.
 * The GNOME extension cannot import this module; `kodoSnapShotNames.test.ts` fails when its
 * copies drift. The extension UUID has one source, `gnome-extension/bundle.json`.
 */

/** Directory under `$XDG_DATA_HOME` for helpers and extension backups. */
export const SNAP_SHOT_DATA_DIRECTORY = APP_PACKAGE_NAME;

/** Session-bus name, object path and interface the GNOME extension exports. */
export const GNOME_EXTENSION_BUS_NAME = "org.gnome.Shell.Extensions.KodoSnapShot";
export const GNOME_EXTENSION_OBJECT_PATH = "/org/gnome/Shell/Extensions/KodoSnapShot";

/** The bus name the extension accepts requests from: `<linux app id>.SnapShot`. */
export const snapShotClientName = (linuxAppId: string) => `${linuxAppId}.SnapShot`;

export const KDE_CAPTURE_DESKTOP_FILE = `${APP_ID}.KdeCapture.desktop`;
export const KDE_CAPTURE_MARKER = "X-KodoCode-Capture-Helper=true";

/** Display name of the extension and the KDE helper. */
export const SNAP_SHOT_HELPER_DISPLAY_NAME = `${APP_BASE_NAME} SnapShots`;
