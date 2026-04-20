import { APP_BASE_NAME, formatAppDisplayName, resolveAppStageLabel } from "@t3tools/shared/product";

export { APP_BASE_NAME };

export const APP_STAGE_LABEL = resolveAppStageLabel(import.meta.env.DEV);
export const APP_DISPLAY_NAME = formatAppDisplayName(APP_STAGE_LABEL);
export const APP_VERSION = import.meta.env.APP_VERSION || "0.0.0";
export const APP_ICON_SRC = "/icon.png";
export const APP_HERO_SRC = "/icon.png";
export const APP_SIDEBAR_SRC = "/logo.svg";
