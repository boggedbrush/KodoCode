import { describe, expect, it } from "vitest";

import {
  resolveDesktopBackendEntryPath,
  resolveDesktopStaticDirPath,
  resolvePackagedAssetPath,
} from "./packagedPaths";

describe("packagedPaths", () => {
  it("prefers the unpacked backend entry in packaged builds", () => {
    const paths = new Set([
      "/tmp/resources/app.asar/apps/server/dist/bin.mjs",
      "/tmp/resources/app.asar.unpacked/apps/server/dist/bin.mjs",
    ]);

    const result = resolveDesktopBackendEntryPath({
      appPath: "/tmp/resources/app.asar",
      existsSync: (path) => paths.has(path),
      isPackaged: true,
      resourcesPath: "/tmp/resources",
    });

    expect(result).toBe("/tmp/resources/app.asar.unpacked/apps/server/dist/bin.mjs");
  });

  it("falls back to the asar backend entry when the unpacked copy is missing", () => {
    const paths = new Set(["/tmp/resources/app.asar/apps/server/dist/bin.mjs"]);

    const result = resolveDesktopBackendEntryPath({
      appPath: "/tmp/resources/app.asar",
      existsSync: (path) => paths.has(path),
      isPackaged: true,
      resourcesPath: "/tmp/resources",
    });

    expect(result).toBe("/tmp/resources/app.asar/apps/server/dist/bin.mjs");
  });

  it("returns the development asset path unchanged outside packaged builds", () => {
    const result = resolvePackagedAssetPath("apps/server/dist/bin.mjs", {
      appPath: "/repo",
      isPackaged: false,
      resourcesPath: "/tmp/resources",
    });

    expect(result).toBe("/repo/apps/server/dist/bin.mjs");
  });

  it("resolves the first packaged static directory with an index file", () => {
    const paths = new Set(["/tmp/resources/app.asar/apps/server/dist/client/index.html"]);

    const result = resolveDesktopStaticDirPath(
      {
        appPath: "/tmp/resources/app.asar",
        existsSync: (path) => paths.has(path),
        isPackaged: true,
        resourcesPath: "/tmp/resources",
      },
      (path) => paths.has(path),
    );

    expect(result).toBe("/tmp/resources/app.asar/apps/server/dist/client");
  });
});
