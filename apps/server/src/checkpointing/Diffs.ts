export interface TurnDiffFileSummary {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

interface MutableTurnDiffFileSummary {
  path: string;
  additions: number;
  deletions: number;
}

interface MutableTurnDiffFileState extends MutableTurnDiffFileSummary {
  inHeader: boolean;
}

function normalizeDiffPath(rawPath: string): string {
  return rawPath.replace(/^b\//, "").trim();
}

function finalizeFile(
  summaries: Array<MutableTurnDiffFileSummary>,
  current: MutableTurnDiffFileState | null,
): MutableTurnDiffFileState | null {
  if (!current || current.path.length === 0) {
    return null;
  }

  summaries.push({
    path: current.path,
    additions: current.additions,
    deletions: current.deletions,
  });
  return null;
}

function decodeGitQuotedPathToken(value: string): string | null {
  let decoded = "";

  for (let index = 1; index < value.length; index += 1) {
    const current = value[index];
    if (current === '"') {
      return decoded;
    }
    if (current !== "\\") {
      decoded += current;
      continue;
    }

    const escape = value[index + 1];
    if (!escape) {
      return null;
    }
    if (/^[0-7]{3}$/.test(value.slice(index + 1, index + 4))) {
      decoded += String.fromCharCode(Number.parseInt(value.slice(index + 1, index + 4), 8));
      index += 3;
      continue;
    }

    decoded += escape === "t" ? "\t" : escape === "n" ? "\n" : escape === "r" ? "\r" : escape;
    index += 1;
  }

  return null;
}

function readGitPathToken(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (!trimmed.startsWith('"')) {
    return trimmed.split(/\s+/, 1)[0] ?? null;
  }

  return decodeGitQuotedPathToken(trimmed);
}

function parseDiffGitHeaderPath(line: string): string | null {
  const prefix = "diff --git ";
  if (!line.startsWith(prefix)) {
    return null;
  }

  const value = line.slice(prefix.length);
  let index = 0;
  let tokenCount = 0;

  while (index < value.length) {
    while (value[index] === " ") {
      index += 1;
    }
    if (index >= value.length) {
      break;
    }

    const rest = value.slice(index);
    const token = readGitPathToken(rest);
    if (token === null) {
      return null;
    }
    tokenCount += 1;
    if (tokenCount === 2) {
      return normalizeDiffPath(token);
    }

    if (rest.startsWith('"')) {
      index += 1;
      while (index < value.length) {
        if (value[index] === "\\") {
          index += 2;
          continue;
        }
        if (value[index] === '"') {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    while (index < value.length && value[index] !== " ") {
      index += 1;
    }
  }

  return null;
}

export function parseTurnDiffFilesFromUnifiedDiff(
  diff: string,
): ReadonlyArray<TurnDiffFileSummary> {
  const normalized = diff.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return [];
  }

  const summaries: Array<MutableTurnDiffFileSummary> = [];
  let current: MutableTurnDiffFileState | null = null;

  for (const line of normalized.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = finalizeFile(summaries, current);
      current = {
        // Diff headers can quote paths with C-style escapes. Parse the tokens
        // instead of assuming plain `a/foo b/foo` text so files with spaces,
        // tabs, or quotes still survive long enough to be finalized.
        path: parseDiffGitHeaderPath(line) ?? "",
        additions: 0,
        deletions: 0,
        inHeader: true,
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (current.inHeader && line.startsWith("rename to ")) {
      const nextPath = readGitPathToken(line.slice("rename to ".length));
      if (nextPath) {
        current.path = normalizeDiffPath(nextPath);
      }
      continue;
    }

    if (current.inHeader && line.startsWith("+++ ")) {
      const nextPath = readGitPathToken(line.slice(4));
      if (nextPath && nextPath !== "/dev/null") {
        current.path = normalizeDiffPath(nextPath);
      }
      continue;
    }

    if (line.startsWith("@@") || line.startsWith("Binary files ") || line === "GIT binary patch") {
      // Only treat `rename to` / `+++` as metadata while we are still in the
      // patch header. Once hunks begin, lines such as `+++ counter` are real
      // file content and must be counted as additions instead of path updates.
      current.inHeader = false;
    }

    if (line.startsWith("+") && !(current.inHeader && line.startsWith("+++ "))) {
      current.additions += 1;
      continue;
    }

    if (line.startsWith("-") && !(current.inHeader && line.startsWith("--- "))) {
      current.deletions += 1;
    }
  }

  finalizeFile(summaries, current);

  return summaries.toSorted((left, right) => left.path.localeCompare(right.path));
}
