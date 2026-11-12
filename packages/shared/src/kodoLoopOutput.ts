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

export const KODO_VERDICT_LABEL = "kodo-verdict";
export const KODO_REVIEW_LABEL = "kodo-review";

/** A block larger than this is refused unread; the schema's own caps are far below it. */
export const KODO_BLOCK_MAX_CHARS = 40_000;

export type KodoBlockFailureReason =
  | "missing"
  | "multiple"
  | "not_final"
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

/** Every block with the label, in order. */
const blocksLabelled = (text: string, label: string): FencedBlock[] =>
  scanFencedBlocks(text).filter((block) => block.label === label);

/**
 * The one block a reply's result lives in: the only block with the label, and the end of the reply,
 * with nothing but whitespace after it. A block anywhere else, or a second one (a quoted example, a
 * line of a diff), cannot stand in for the answer or override it.
 */
function finalBlock(
  text: string,
  label: string,
):
  | { readonly ok: true; readonly block: FencedBlock }
  | { readonly ok: false; readonly reason: KodoBlockFailureReason; readonly detail: string } {
  const blocks = blocksLabelled(text, label);
  const block = blocks.at(-1);
  if (block === undefined) {
    return { ok: false, reason: "missing", detail: `no \`${label}\` block in the reply` };
  }
  if (blocks.length > 1) {
    return {
      ok: false,
      reason: "multiple",
      detail: `more than one \`${label}\` block in the reply`,
    };
  }
  if (!block.closed) {
    return { ok: false, reason: "unterminated", detail: `the \`${label}\` block is not closed` };
  }
  if (text.slice(block.end).trim().length > 0) {
    return {
      ok: false,
      reason: "not_final",
      detail: `the \`${label}\` block is not the end of the reply`,
    };
  }
  return { ok: true, block };
}

const decodeVerdictExit = Schema.decodeUnknownExit(KodoLoopVerdict);
const decodeReviewExit = Schema.decodeUnknownExit(KodoReviewResult);

const oneLine = (value: string) => value.replace(/\s*\n\s*/g, " ").trim();

function parseBlock<T>(
  text: string,
  label: string,
  decode: (value: unknown) => Exit.Exit<T, unknown>,
): KodoBlockResult<T> {
  const found = finalBlock(text, label);
  if (!found.ok) return found;
  const { block } = found;
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
  const found = finalBlock(text, label);
  return found.ok ? text.slice(0, found.block.start).trimEnd() : text;
}

/** A reply's result blocks once read: the reply without them, and what they said. */
export interface KodoReplyBlocks {
  readonly text: string;
  readonly review: KodoReviewResultValue | null;
  readonly verdict: KodoLoopVerdictValue | null;
}

/**
 * The reply with its valid trailing `kodo-review` or `kodo-verdict` block taken out, and the result
 * it held. A reply with an unreadable or misplaced block is returned as written. `only` limits
 * which label is looked for, since a block outside the stage that asked for it is an example.
 */
export function readKodoReplyBlocks(
  text: string,
  only: { readonly review?: boolean; readonly verdict?: boolean } = { review: true, verdict: true },
): KodoReplyBlocks {
  const wantReview = only.review === true && text.includes(KODO_REVIEW_LABEL);
  const wantVerdict = only.verdict === true && text.includes(KODO_VERDICT_LABEL);
  const review = wantReview ? parseKodoReview(text) : undefined;
  const verdict = wantVerdict ? parseKodoVerdict(text) : undefined;
  let remaining = text;
  if (review?.ok) remaining = stripKodoBlock(remaining, KODO_REVIEW_LABEL);
  if (verdict?.ok) remaining = stripKodoBlock(remaining, KODO_VERDICT_LABEL);
  return {
    text: review?.ok || verdict?.ok ? remaining : text,
    review: review?.ok ? review.value : null,
    verdict: verdict?.ok ? verdict.value : null,
  };
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** A review as plain text, for a client that shows no list of its own: one line per finding. */
export function describeKodoReview(review: KodoReviewResultValue): string {
  const head =
    review.findings.length === 0
      ? `Review: ${review.verdict}.`
      : `Review: ${review.verdict}, ${plural(review.findings.length, "finding")}.`;
  const lines = review.findings.map((finding) => {
    const where =
      finding.file === undefined
        ? ""
        : ` (${finding.file}${finding.line === undefined ? "" : `:${finding.line}`})`;
    return `- [${finding.severity}] ${finding.title}${where}`;
  });
  return [head, review.summary, ...lines].filter((line) => line.length > 0).join("\n");
}

/** A verdict as plain text: complete or not, and what is outstanding. */
export function describeKodoVerdict(verdict: KodoLoopVerdictValue): string {
  const lines = verdict.outstanding.map((item) => `- ${item.title}`);
  return [
    verdict.complete ? "Verdict: complete." : "Verdict: not complete.",
    verdict.summary,
    ...lines,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * A reply for a client that has no list of its own (mobile): a valid trailing result block is
 * replaced by its plain-text summary, so no raw JSON shows. Any other reply is returned as written.
 */
export function renderKodoBlocksAsText(text: string): string {
  if (!text.includes(KODO_REVIEW_LABEL) && !text.includes(KODO_VERDICT_LABEL)) return text;
  const read = readKodoReplyBlocks(text);
  if (read.review === null && read.verdict === null) return text;
  return [
    read.text,
    read.review === null ? "" : describeKodoReview(read.review),
    read.verdict === null ? "" : describeKodoVerdict(read.verdict),
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}
