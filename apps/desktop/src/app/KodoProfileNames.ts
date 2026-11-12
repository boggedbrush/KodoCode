import { APP_BASE_NAME, APP_PACKAGE_NAME, APP_RELEASE_STAGE_LABEL } from "@t3tools/shared/appBrand";

/**
 * Directories under the OS app-data folder that belong to this distribution.
 * They must never equal upstream's (`t3code-v2`, `t3code-dev`, `T3 Code (...)`):
 * Electron keys the single-instance lock and the Chromium profile on this path.
 */
export const resolveProfileNames = (isDevelopment: boolean) =>
  isDevelopment
    ? { current: `${APP_PACKAGE_NAME}-dev`, legacy: `${APP_BASE_NAME} (Dev)` }
    : { current: APP_PACKAGE_NAME, legacy: `${APP_BASE_NAME} (${APP_RELEASE_STAGE_LABEL})` };

/** Profiles written by earlier builds of this app, whose localStorage is imported once. */
export const LEGACY_PROFILE_NAMES = [resolveProfileNames(false).legacy] as const;
