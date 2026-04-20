import product from "../../../product.json" with { type: "json" };

export const PRODUCT_METADATA = product as {
  readonly appBaseName: string;
  readonly releaseRepoOwner: string;
  readonly releaseRepoName: string;
  readonly latestReleaseCacheKey: string;
  readonly releaseTitlePrefix: string;
};

export const APP_BASE_NAME = PRODUCT_METADATA.appBaseName;
export const RELEASE_REPO_OWNER = PRODUCT_METADATA.releaseRepoOwner;
export const RELEASE_REPO_NAME = PRODUCT_METADATA.releaseRepoName;
export const RELEASE_REPO_SLUG = `${RELEASE_REPO_OWNER}/${RELEASE_REPO_NAME}`;
export const RELEASE_REPO_URL = `https://github.com/${RELEASE_REPO_SLUG}`;
export const RELEASES_URL = `${RELEASE_REPO_URL}/releases`;
export const RELEASES_API_URL = `https://api.github.com/repos/${RELEASE_REPO_SLUG}/releases/latest`;
export const LATEST_RELEASE_CACHE_KEY = PRODUCT_METADATA.latestReleaseCacheKey;
export const RELEASE_TITLE_PREFIX = PRODUCT_METADATA.releaseTitlePrefix;

export type AppStageLabel = "Dev" | "Alpha";

export function resolveAppStageLabel(isDevelopment: boolean): AppStageLabel {
  return isDevelopment ? "Dev" : "Alpha";
}

export function formatAppDisplayName(stageLabel: string): string {
  return `${APP_BASE_NAME} (${stageLabel})`;
}
