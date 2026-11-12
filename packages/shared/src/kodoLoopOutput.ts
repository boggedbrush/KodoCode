// Reads the fenced `kodo-verdict` and `kodo-review` blocks a Judge or Review run ends with. Shared
// by the server (loop stepping) and the web (findings card). Text works on every provider, where a
// tool call can be skipped; so a missing, malformed or self-contradicting block fails closed.
import {
  KodoLoopVerdict,
  KodoReviewResult,
  type KodoLoopVerdict as KodoLoopVerdictValue,
  type KodoReviewResult as KodoReviewResultValue,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

const KODO_VERDICT_LABEL = "kodo-verdict";
export const KODO_REVIEW_LABEL = "kodo-review";

/** A block larger than this is refused unread; the schema's own caps are far below it. */
export const KODO_BLOCK_MAX_CHARS = 40_000;

export type KodoBlockFailureReason =
  | "missing"
  | "unterminated"
  | "too_large"
  | "invalid_json"
  | "invalid";

export type KodoBlockResult<T> =
  | { readonly ok: true; readonly value: T; readonly raw: string }
  | {
      readonly ok: false;
      readonly reason: KodoBlockFailureReason;
      /** One line a person can read, for the loop summary. */
      readonly detail: string;
    };

interface FencedBlock {
  readonly label: string;
  readonly body: string;
  /** Offsets of the opening line's start and the end of the closing line (or of the text). */
  readonly start: number;
  readonly end: number;
  readonly closed: boolean;
}

const OPEN_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CLOSE_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * Every fenced block in order. A fence quoted inside a longer outer fence is part of that outer
 * block, not a block of its own, so an example the agent quotes is never mistaken for its answer.
 */
function scanFencedBlocks(text: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  let open:
    | {
        readonly char: string;
        readonly length: number;
        readonly label: string;
        readonly start: number;
        readonly bodyStart: number;
      }
    | undefined;
  let offset = 0;
  while (offset <= text.length) {
    const newline = text.indexOf("\n", offset);
    const lineEnd = newline === -1 ? text.length : newline;
    const next = newline === -1 ? text.length + 1 : newline + 1;
    const line = text.slice(offset, lineEnd).replace(/\r$/, "");
    if (open === undefined) {
      const match = OPEN_FENCE.exec(line);
      const fence = match?.[1];
      const info = match?.[2]?.trim() ?? "";
      // A backtick fence cannot have a backtick in its info string; that is inline code.
      if (fence !== undefined && !(fence.startsWith("`") && info.includes("`"))) {
        open = {
          char: fence.charAt(0),
          length: fence.length,
          label: info.split(/\s+/)[0] ?? "",
          start: offset,
          bodyStart: next,
        };
      }
    } else {
      const fence = CLOSE_FENCE.exec(line)?.[1];
      if (fence !== undefined && fence.startsWith(open.char) && fence.length >= open.length) {
        blocks.push({
          label: open.label,
          body: text.slice(open.bodyStart, offset).replace(/\r?\n$/, ""),
          start: open.start,
          end: Math.min(next, text.length),
          closed: true,
        });
        open = undefined;
      }
    }
    offset = next;
  }
  if (open !== undefined) {
    blocks.push({
      label: open.label,
      body: text.slice(Math.min(open.bodyStart, text.length)),
      start: open.start,
      end: text.length,
      closed: false,
    });
  }
  return blocks;
}

/** The last block with the label wins; an earlier valid one never stands in for a bad last one. */
const lastBlock = (text: string, label: string): FencedBlock | undefined =>
  scanFencedBlocks(text)
    .filter((block) => block.label === label)
    .at(-1);

const decodeVerdictExit = Schema.decodeUnknownExit(KodoLoopVerdict);
const decodeReviewExit = Schema.decodeUnknownExit(KodoReviewResult);

const oneLine = (value: string) => value.replace(/\s*\n\s*/g, " ").trim();

function parseBlock<T>(
  text: string,
  label: string,
  decode: (value: unknown) => Exit.Exit<T, unknown>,
): KodoBlockResult<T> {
  const block = lastBlock(text, label);
  if (block === undefined) {
    return { ok: false, reason: "missing", detail: `no \`${label}\` block in the reply` };
  }
  if (!block.closed) {
    return { ok: false, reason: "unterminated", detail: `the \`${label}\` block is not closed` };
  }
  if (block.body.length > KODO_BLOCK_MAX_CHARS) {
    return { ok: false, reason: "too_large", detail: `the \`${label}\` block is too large` };
  }
  let json: unknown;
  try {
    json = JSON.parse(block.body);
  } catch {
    return {
      ok: false,
      reason: "invalid_json",
      detail: `the \`${label}\` block is not valid JSON`,
    };
  }
  const decoded = decode(json);
  if (Exit.isSuccess(decoded)) return { ok: true, value: decoded.value, raw: block.body };
  const error = Cause.squash(decoded.cause);
  const message = Schema.isSchemaError(error) ? oneLine(error.message) : "unreadable";
  return {
    ok: false,
    reason: "invalid",
    detail: `the \`${label}\` block is not a valid result: ${message}`.slice(0, 400),
  };
}

export const parseKodoVerdict = (text: string): KodoBlockResult<KodoLoopVerdictValue> =>
  parseBlock(text, KODO_VERDICT_LABEL, decodeVerdictExit);

export const parseKodoReview = (text: string): KodoBlockResult<KodoReviewResultValue> =>
  parseBlock(text, KODO_REVIEW_LABEL, decodeReviewExit);

/** The text without the block `parseKodoVerdict` or `parseKodoReview` reads, for a reply a card replaces. */
export function stripKodoBlock(text: string, label: string): string {
  const block = lastBlock(text, label);
  if (block === undefined || !block.closed) return text;
  const before = text.slice(0, block.start).trimEnd();
  const after = text.slice(block.end).trimStart();
  return before.length > 0 && after.length > 0 ? `${before}\n\n${after}` : `${before}${after}`;
}
