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

function normalizeDiffPath(rawPath: string): string {
  return rawPath.replace(/^b\//, "").trim();
}

function finalizeFile(
  summaries: Array<MutableTurnDiffFileSummary>,
  current: MutableTurnDiffFileSummary | null,
): MutableTurnDiffFileSummary | null {
  if (!current || current.path.length === 0) {
    return null;
  }

  summaries.push(current);
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
  let current: MutableTurnDiffFileSummary | null = null;

  for (const line of normalized.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = finalizeFile(summaries, current);
      const match = /^diff --git a\/.+? b\/(.+)$/.exec(line);
      current = {
        path: match ? normalizeDiffPath(match[1] ?? "") : "",
        additions: 0,
        deletions: 0,
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("rename to ")) {
      current.path = normalizeDiffPath(line.slice("rename to ".length));
      continue;
    }

    if (line.startsWith("+++ ")) {
      const nextPath = line.slice(4).trim();
      if (nextPath !== "/dev/null") {
        current.path = normalizeDiffPath(nextPath);
      }
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.additions += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      current.deletions += 1;
    }
  }

  finalizeFile(summaries, current);

  return summaries.toSorted((left, right) => left.path.localeCompare(right.path));
}
