// Repo-relative POSIX path helpers shared by the Kodo overlay tooling. Globs
// are matched by our own small translator instead of `path.matchesGlob`,
// because that one skips dot-directories (`.github/**` would never match).

const GLOB_CHARS = /[*?{}[\]]/;

export const isGlob = (pattern: string): boolean => GLOB_CHARS.test(pattern);

const escapeRegex = (text: string): string => text.replace(/[.+^$()|\\]/g, "\\$&");

// `**/` matches zero or more directories, `**` matches anything, `*` and `?`
// stay inside one path segment, and `{a,b}` is an alternation. A pattern that
// ends in `/` means the whole directory.
export const globToRegExp = (pattern: string): RegExp => {
  const source = pattern.endsWith("/") ? `${pattern}**` : pattern;
  let out = "";
  let braceDepth = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source[i] as string;
    if (char === "*") {
      if (source[i + 1] === "*") {
        const slashAfter = source[i + 2] === "/";
        out += slashAfter ? "(?:.*/)?" : ".*";
        i += slashAfter ? 2 : 1;
      } else {
        out += "[^/]*";
      }
    } else if (char === "?") {
      out += "[^/]";
    } else if (char === "{") {
      braceDepth++;
      out += "(?:";
    } else if (char === "}" && braceDepth > 0) {
      braceDepth--;
      out += ")";
    } else if (char === "," && braceDepth > 0) {
      out += "|";
    } else {
      out += escapeRegex(char);
    }
  }
  return new RegExp(`^${out}$`);
};

export const matchesGlob = (path: string, pattern: string): boolean =>
  globToRegExp(pattern).test(path);

export const matchesAnyGlob = (path: string, patterns: ReadonlyArray<string>): boolean =>
  patterns.some((pattern) => matchesGlob(path, pattern));

// A Kodo-owned path is a file, or a directory when it ends in `/` or is a glob.
export const matchesOwnedPath = (path: string, owned: string): boolean =>
  isGlob(owned) || owned.endsWith("/") ? matchesGlob(path, owned) : path === owned;

// Why a manifest path is unusable, or undefined when it is a clean repo-relative POSIX path.
export const describeBadRelativePath = (path: string): string | undefined => {
  if (path.length === 0) return "is empty";
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return "must be relative to the repo root";
  if (path.includes("\\")) return "must use forward slashes";
  if (path.split("/").some((segment) => segment === ".." || segment === ".")) {
    return 'must not contain "." or ".." segments';
  }
  return undefined;
};
