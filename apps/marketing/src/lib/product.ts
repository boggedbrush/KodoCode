import product from "../../../../product.json" with { type: "json" };

export const APP_BASE_NAME = product.appBaseName;
export const RELEASE_REPO_OWNER = product.releaseRepoOwner;
export const RELEASE_REPO_NAME = product.releaseRepoName;
export const RELEASE_REPO_SLUG = `${RELEASE_REPO_OWNER}/${RELEASE_REPO_NAME}`;
export const RELEASE_REPO_URL = `https://github.com/${RELEASE_REPO_SLUG}`;
export const RELEASES_URL = `${RELEASE_REPO_URL}/releases`;
export const RELEASES_API_URL = `https://api.github.com/repos/${RELEASE_REPO_SLUG}/releases/latest`;
export const LATEST_RELEASE_CACHE_KEY = product.latestReleaseCacheKey;
