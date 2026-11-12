// Test helpers: a manifest builder and an in-memory OverlayIo.
import { type KodoManifest, type KodoManifestInput, validateManifest } from "./manifest.ts";
import type { OverlayIo } from "./overlay.ts";

const encoder = new TextEncoder();

export const makeManifest = (overrides: Partial<KodoManifestInput> = {}): KodoManifest => {
  const input: KodoManifestInput = {
    version: 1,
    upstream: {
      repo: "upstream/app",
      forkRepo: "fork/app",
      remote: "upstream",
      branch: "main",
      logFile: "docs/upstream-sync-log.md",
      lockfiles: ["pnpm-lock.yaml"],
    },
    assets: [],
    replacements: [],
    jsonEdits: [],
    hooks: [],
    kodoOwned: [],
    leakChecks: [],
    verify: { testFiles: [], typecheckPackages: [], commands: [] },
    ...overrides,
  };
  const validation = validateManifest(input);
  if (!validation.ok) throw new Error(validation.problems.join("\n"));
  return validation.manifest;
};

export const memoryIo = (
  initial: Record<string, string | Uint8Array>,
): OverlayIo & { readonly files: Map<string, Uint8Array>; readonly writes: string[] } => {
  const files = new Map<string, Uint8Array>(
    Object.entries(initial).map(([path, data]) => [
      path,
      typeof data === "string" ? encoder.encode(data) : data,
    ]),
  );
  const writes: string[] = [];
  return {
    files,
    writes,
    listFiles: () => [...files.keys()].toSorted(),
    readBytes: (path) => files.get(path),
    dirExists: (path) => [...files.keys()].some((file) => file.startsWith(`${path}/`)),
    write: (path, data) => {
      files.set(path, typeof data === "string" ? encoder.encode(data) : data);
      writes.push(path);
    },
  };
};

export const textOf = (io: { readonly files: Map<string, Uint8Array> }, path: string): string =>
  new TextDecoder().decode(io.files.get(path));
