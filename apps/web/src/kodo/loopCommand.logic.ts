/**
 * A `/loop stop` or `/loop status` message: the server answers it without starting a turn or
 * recording a message, so the composer shows no bubble for it (the loop card and the thread's error
 * line carry the answer). Mirrors the server's reading of the command.
 */
export function isKodoLoopQuery(text: string): boolean {
  const trimmed = text.trim();
  if (!/^\/loop(?=\s|$)/iu.test(trimmed)) return false;
  const argument = trimmed.slice("/loop".length).trim().toLowerCase();
  return argument === "stop" || argument === "status";
}
