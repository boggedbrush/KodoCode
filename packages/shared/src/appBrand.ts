/**
 * The product identity of this distribution. Web, desktop and the build
 * scripts read it from here so a rebrand is one file. Internal identifiers
 * (`@t3tools/*`, `T3CODE_*`, URL schemes, `t3.json`) stay as upstream names them.
 */
export const APP_BASE_NAME = "Kodo Code";

/** Stage label of a stable (non-nightly, non-dev) build. */
export const APP_RELEASE_STAGE_LABEL = "Alpha";

/** Reverse-DNS application id: Windows AppUserModelId, macOS bundle id, Linux window class. */
export const APP_ID = "app.kodocode";

/**
 * Staged package name, Linux executable and `.deb` package, and the Electron
 * user-data and updater-cache directories. Matches the previous Kodo release so
 * existing profiles keep working. Upstream uses `t3code`; never share it.
 */
export const APP_PACKAGE_NAME = "kodo-code";

/** The GitHub repository whose releases desktop builds update from. Never upstream's. */
export const APP_REPOSITORY = "boggedbrush/KodoCode";

export const APP_REPOSITORY_URL = `https://github.com/${APP_REPOSITORY}`;

export const APP_RELEASES_URL = `${APP_REPOSITORY_URL}/releases`;

export const APP_MAINTAINER = "Kodo Code";
