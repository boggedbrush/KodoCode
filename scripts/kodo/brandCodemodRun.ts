// The brand codemod over a set of files: scope resolution and per-file results.
// Pure over OverlayIo; the engine decides when to write.
import { type CodemodOptions, normalizedTokens, transformBrandLiterals } from "./brandCodemod.ts";
import { type BrandCodemodConfig, isPlaceholder } from "./manifest.ts";
import type { EntryResult, OverlayIo } from "./overlay.ts";
import { isGlob, matchesAnyGlob, matchesGlob } from "./paths.ts";

export const codemodInScope = (config: BrandCodemodConfig, path: string): boolean =>
  config.files.some((pattern) =>
    isGlob(pattern) ? matchesGlob(path, pattern) : path === pattern,
  ) && !matchesAnyGlob(path, config.exclude);

// Keep entries without `text` keep the whole file.
export const codemodKeepsFile = (config: BrandCodemodConfig, path: string): boolean =>
  config.keep.some((keep) => keep.text === undefined && matchesGlob(path, keep.file));

export const codemodOptionsFor = (config: BrandCodemodConfig, path: string): CodemodOptions => ({
  brand: config.brand,
  expression: config.expression,
  importName: config.importName,
  importFrom: config.importFrom,
  keepTexts: config.keep.flatMap((keep) =>
    keep.text !== undefined && matchesGlob(path, keep.file) ? [keep.text] : [],
  ),
});

const decoder = new TextDecoder();

export const evaluateBrandCodemod = (
  config: BrandCodemodConfig,
  io: OverlayIo,
  write: boolean,
): ReadonlyArray<EntryResult> => {
  if (isPlaceholder(config)) {
    return [
      {
        section: "codemod",
        id: "brand-codemod",
        status: "placeholder",
        details: [`TODO placeholder, not enforced: ${config.todo}`],
      },
    ];
  }
  const results: EntryResult[] = [];
  for (const path of io.listFiles()) {
    if (!codemodInScope(config, path) || codemodKeepsFile(config, path)) continue;
    const bytes = io.readBytes(path);
    if (bytes === undefined) continue;
    const source = decoder.decode(bytes);
    if (!source.includes(config.brand)) continue;
    const result = transformBrandLiterals(source, path, codemodOptionsFor(config, path));
    const unsafe = result.reports.map(
      (report) =>
        `brandCodemod ${path}:${report.line}: ${report.reason}: ${report.text}. Rewrite it by hand or add a brandCodemod.keep entry with a reason.`,
    );
    if (result.rewritten === 0 && unsafe.length === 0) continue;
    if (write && result.output !== source) io.write(path, result.output);
    const status = unsafe.length > 0 ? "mismatch" : write ? "applied" : "pending";
    results.push({
      section: "codemod",
      id: path,
      status,
      details: [
        ...(result.rewritten > 0
          ? [`${result.rewritten} literal(s) rewritten to \${${config.expression}}`]
          : []),
        ...unsafe,
      ],
    });
  }
  return results;
};

// Whether `ours` is exactly the codemod's output for `base`, ignoring formatting.
export const isCodemodOutput = (
  config: BrandCodemodConfig,
  path: string,
  base: string,
  ours: string,
): boolean => {
  const result = transformBrandLiterals(base, path, codemodOptionsFor(config, path));
  if (result.reports.length > 0) return false;
  const expected = normalizedTokens(result.output, path);
  const actual = normalizedTokens(ours, path);
  return (
    expected.length === actual.length && expected.every((token, index) => token === actual[index])
  );
};
