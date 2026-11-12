// A small Myers diff over token arrays, used to show where a file differs from
// the codemod's output beyond formatting. Gives up (undefined) on huge differences.

export interface TokenHunk {
  readonly aStart: number;
  readonly aEnd: number;
  readonly bStart: number;
  readonly bEnd: number;
}

const MAX_EDIT_DISTANCE = 800;

export const diffTokens = (
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): TokenHunk[] | undefined => {
  const n = a.length;
  const m = b.length;
  const offset = n + m + 1;
  const v = new Int32Array(2 * offset + 2);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= Math.min(n + m, MAX_EDIT_DISTANCE) && found < 0; d++) {
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number))
          ? (v[offset + k + 1] as number)
          : (v[offset + k - 1] as number) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return undefined;

  const edits: Array<{ aStart: number; aEnd: number; bStart: number; bEnd: number }> = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const previous = trace[d] as Int32Array;
    const k = x - y;
    const goesDown =
      k === -d || (k !== d && (previous[k - 1 + d] as number) < (previous[k + 1 + d] as number));
    const previousK = goesDown ? k + 1 : k - 1;
    const previousX = previous[previousK + d] as number;
    const previousY = previousX - previousK;
    const midX = goesDown ? previousX : previousX + 1;
    const midY = goesDown ? previousY + 1 : previousY;
    edits.push({ aStart: previousX, aEnd: midX, bStart: previousY, bEnd: midY });
    x = previousX;
    y = previousY;
  }
  const hunks: TokenHunk[] = [];
  for (const edit of edits.toReversed()) {
    const last = hunks.at(-1);
    if (last && last.aEnd === edit.aStart && last.bEnd === edit.bStart) {
      hunks[hunks.length - 1] = { ...last, aEnd: edit.aEnd, bEnd: edit.bEnd };
    } else hunks.push(edit);
  }
  return hunks;
};
