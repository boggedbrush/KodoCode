// Reads a `/loop` control message: `/loop <request>`, `/loop <N> <request>`, `/loop stop` and
// `/loop status`. Pure, so the web composer, the server funnel and tests share one reading.
import { KODO_LOOP_MAX_ROUNDS, KODO_LOOP_REQUEST_MAX_CHARS } from "@t3tools/contracts";

export type KodoLoopCommand =
  | { readonly type: "start"; readonly request: string; readonly maxRounds: number | undefined }
  | { readonly type: "stop" }
  | { readonly type: "status" }
  /** A `/loop` message that cannot start anything; `message` says why, for the person who typed it. */
  | { readonly type: "invalid"; readonly message: string };

const KODO_LOOP_USAGE =
  "Usage: /loop <request>, /loop <rounds> <request>, /loop stop, /loop status";

/** The word `/loop` on its own at the start: `/loops` or `/loop-x` are other text. */
const LOOP_PREFIX = /^\/loop(?=\s|$)/iu;
const LEADING_ROUNDS = /^(\d+)(?:\s+|$)/u;

/** Null when the text is not a `/loop` message at all, so ordinary prompts pass through untouched. */
export function parseLoopCommand(text: string): KodoLoopCommand | null {
  const trimmed = text.trim();
  if (!LOOP_PREFIX.test(trimmed)) return null;
  const argument = trimmed.slice("/loop".length).trim();
  switch (argument.toLowerCase()) {
    case "stop":
      return { type: "stop" };
    case "status":
      return { type: "status" };
    case "":
      return { type: "invalid", message: `Say what the loop should do. ${KODO_LOOP_USAGE}` };
  }
  const rounds = LEADING_ROUNDS.exec(argument);
  const request = (rounds === null ? argument : argument.slice(rounds[0].length)).trim();
  let maxRounds: number | undefined;
  if (rounds !== null) {
    maxRounds = Number(rounds[1]);
    if (!Number.isSafeInteger(maxRounds) || maxRounds < 1 || maxRounds > KODO_LOOP_MAX_ROUNDS) {
      return {
        type: "invalid",
        message: `A loop runs between 1 and ${KODO_LOOP_MAX_ROUNDS} rounds. ${KODO_LOOP_USAGE}`,
      };
    }
  }
  if (request.length === 0) {
    return { type: "invalid", message: `Say what the loop should do. ${KODO_LOOP_USAGE}` };
  }
  if (request.length > KODO_LOOP_REQUEST_MAX_CHARS) {
    return {
      type: "invalid",
      message: `The request is ${request.length.toLocaleString("en-US")} characters; a loop takes at most ${KODO_LOOP_REQUEST_MAX_CHARS.toLocaleString("en-US")}.`,
    };
  }
  return { type: "start", request, maxRounds };
}
