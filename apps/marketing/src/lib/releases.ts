// FILE: releases.ts
// Purpose: Defines the GitHub release source used by the marketing site download flows.
// Layer: Marketing util
// Exports: repo/release URLs plus the latest-release fetch helper.

import {
  APP_BASE_NAME,
  LATEST_RELEASE_CACHE_KEY,
  RELEASE_REPO_URL,
  RELEASES_API_URL,
  RELEASES_URL,
} from "./product";

export const REPO_URL = RELEASE_REPO_URL;
export { APP_BASE_NAME, RELEASES_URL };

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface Release {
  tag_name: string;
  html_url: string;
  assets: ReleaseAsset[];
}

export async function fetchLatestRelease(): Promise<Release> {
  const cached = sessionStorage.getItem(LATEST_RELEASE_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const data = await fetch(RELEASES_API_URL).then((r) => r.json());

  if (data?.assets) {
    sessionStorage.setItem(LATEST_RELEASE_CACHE_KEY, JSON.stringify(data));
  }

  return data;
}
