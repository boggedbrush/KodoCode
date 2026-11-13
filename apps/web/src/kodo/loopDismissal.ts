// Which finished loops a person dismissed, remembered in this browser only: a per-viewer convenience,
// so a reload does not bring a dismissed card back and a later loop always shows. Storage can be
// missing or throw (private windows, blocked site data); then nothing is remembered and the card shows.
const STORAGE_KEY = "kodo:dismissed-loops";
const MAX_REMEMBERED = 50;

export function readDismissedLoopIds(): ReadonlySet<string> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed: unknown = raw == null ? [] : JSON.parse(raw);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

/** The set with `loopId` added, written back with only the most recent entries kept. */
export function rememberDismissedLoop(
  current: ReadonlySet<string>,
  loopId: string,
): ReadonlySet<string> {
  const next = new Set([...current, loopId]);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...next].slice(-MAX_REMEMBERED)));
  } catch {
    // Not remembered: the card is only hidden until the page reloads.
  }
  return next;
}
