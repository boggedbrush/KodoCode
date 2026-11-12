// The verification rule: every test file the Kodo layer adds or edits must be in
// `verify.testFiles` (or carry a reasoned `verify.testExempt` entry), so the tests that guard
// the layer cannot be forgotten by a sync. Pure; the engine supplies the layer's files.
import type { KodoManifest } from "./manifest.ts";

export const isTestFile = (path: string): boolean => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);

export interface VerifyCoverage {
  // Layer-touched test files neither verified nor exempt.
  readonly unverified: ReadonlyArray<string>;
  // Manifest entries that point at no existing file.
  readonly stale: ReadonlyArray<string>;
}

export const findVerifyCoverage = (
  verify: KodoManifest["verify"],
  layerFiles: ReadonlyArray<string>,
  exists: (path: string) => boolean,
): VerifyCoverage => {
  const covered = new Set([...verify.testFiles, ...verify.testExempt.map((entry) => entry.file)]);
  return {
    unverified: layerFiles.filter((path) => isTestFile(path) && !covered.has(path)).toSorted(),
    stale: [
      ...verify.testFiles
        .filter((path) => !exists(path))
        .map((path) => `verify.testFiles: ${path}`),
      ...verify.testExempt
        .filter((entry) => !exists(entry.file))
        .map((entry) => `verify.testExempt: ${entry.file}`),
    ],
  };
};
