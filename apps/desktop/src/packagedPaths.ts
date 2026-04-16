import * as Path from "node:path";

export interface PackagedPathResolverOptions {
  readonly appPath: string;
  readonly existsSync?: (path: string) => boolean;
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
}

const defaultExistsSync = (_path: string): boolean => false;

function dedupePaths(paths: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(paths)];
}

function getPackagedAppRoots({
  appPath,
  isPackaged,
  resourcesPath,
}: PackagedPathResolverOptions): ReadonlyArray<string> {
  if (!isPackaged) {
    return [appPath];
  }

  return dedupePaths([
    Path.join(resourcesPath, "app.asar.unpacked"),
    appPath,
    Path.join(resourcesPath, "app.asar"),
  ]);
}

export function resolvePackagedAssetPath(
  relativePath: string,
  options: PackagedPathResolverOptions,
  preferences?: {
    readonly preferUnpacked?: boolean;
  },
): string {
  const existsSync = options.existsSync ?? defaultExistsSync;
  const roots = getPackagedAppRoots(options);
  const orderedRoots =
    options.isPackaged && preferences?.preferUnpacked === true
      ? dedupePaths([Path.join(options.resourcesPath, "app.asar.unpacked"), ...roots])
      : roots;

  for (const root of orderedRoots) {
    const candidate = Path.join(root, relativePath);
    if (!options.isPackaged || existsSync(candidate)) {
      return candidate;
    }
  }

  return Path.join(orderedRoots[0] ?? options.appPath, relativePath);
}

export function resolveDesktopBackendEntryPath(options: PackagedPathResolverOptions): string {
  return resolvePackagedAssetPath("apps/server/dist/bin.mjs", options, {
    preferUnpacked: true,
  });
}

export function resolveDesktopStaticDirPath(
  options: PackagedPathResolverOptions,
  existsSync: (path: string) => boolean = options.existsSync ?? defaultExistsSync,
): string | null {
  const roots = getPackagedAppRoots(options);
  for (const root of roots) {
    for (const relativePath of ["apps/server/dist/client", "apps/web/dist"] as const) {
      const candidate = Path.join(root, relativePath);
      if (existsSync(Path.join(candidate, "index.html"))) {
        return candidate;
      }
    }
  }

  return null;
}
