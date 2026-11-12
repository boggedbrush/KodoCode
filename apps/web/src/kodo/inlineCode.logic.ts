export type InlineSegment = {
  readonly kind: "text" | "code";
  readonly text: string;
  /** Where the segment starts in the source text; unique within one split, so it can key a row. */
  readonly start: number;
};

/**
 * Splits text at single-backtick spans: `like this` is code. Only a backtick that has a partner on the
 * same line with something between them opens a span; any other backtick stays literal text, so an
 * unbalanced or empty pair never swallows the rest of the sentence.
 */
export function splitInlineCode(text: string): ReadonlyArray<InlineSegment> {
  const segments: InlineSegment[] = [];
  let plain = "";
  let plainStart = 0;
  let index = 0;
  while (index < text.length) {
    if (text[index] === "`") {
      const end = text.indexOf("`", index + 1);
      if (end > index + 1 && !text.slice(index + 1, end).includes("\n")) {
        if (plain.length > 0) segments.push({ kind: "text", text: plain, start: plainStart });
        plain = "";
        segments.push({ kind: "code", text: text.slice(index + 1, end), start: index });
        index = end + 1;
        plainStart = index;
        continue;
      }
    }
    plain += text[index];
    index += 1;
  }
  if (plain.length > 0) segments.push({ kind: "text", text: plain, start: plainStart });
  return segments;
}
