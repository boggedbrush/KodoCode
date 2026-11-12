import { describe, expect, it } from "@effect/vitest";
import {
  KODO_LOOP_CONCLUSION_MAX_CHARS,
  KODO_LOOP_MAX_ROUNDS,
  KODO_LOOP_RECORD_OUTSTANDING_MAX,
  KODO_LOOP_STAGES_PER_ROUND,
  KodoLoop,
  KodoLoopStageRecord,
  KODO_VERDICT_MAX_OUTSTANDING,
  MessageId,
  RunId,
  type KodoLoopVerdict,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { clipLine, compactReview, compactVerdict, firstSayingLine } from "./loopRecord.ts";
import { testLoop } from "./testing.ts";

const encodeLoop = Schema.encodeSync(KodoLoop);
const encodeRecord = Schema.encodeSync(KodoLoopStageRecord);
const decodeRecord = Schema.decodeUnknownSync(KodoLoopStageRecord);

const verdict = (count: number): KodoLoopVerdict => ({
  version: 1,
  complete: false,
  summary: "s".repeat(600),
  outstanding: Array.from({ length: count }, (_, index) => ({
    id: `o${index}`,
    title: "t".repeat(200),
    detail: "d".repeat(2_000),
  })),
  approach: "a".repeat(2_000),
});

describe("what a stage record keeps", () => {
  it("cuts the Judge's answer to headlines: a count and the first titles, no detail", () => {
    const compact = compactVerdict(verdict(KODO_VERDICT_MAX_OUTSTANDING));
    expect(compact.outstandingCount).toBe(KODO_VERDICT_MAX_OUTSTANDING);
    expect(compact.outstanding).toHaveLength(KODO_LOOP_RECORD_OUTSTANDING_MAX);
    expect(compact.outstanding.every((item) => item.title.length <= 120)).toBe(true);
    expect(JSON.stringify(compact)).not.toContain("dddd");
  });

  it("keeps a review as its verdict and counts, or notes that it was unreadable", () => {
    expect(
      compactReview(
        {
          version: 1,
          verdict: "blocking",
          summary: "x",
          findings: [
            { id: "a", severity: "high", title: "t", detail: "d" },
            { id: "b", severity: "low", title: "t", detail: "d" },
          ],
        },
        true,
      ),
    ).toEqual({ parsed: true, verdict: "blocking", findings: 2, high: 1 });
    expect(compactReview(undefined, false)).toEqual({ parsed: false, findings: 0, high: 0 });
  });

  it("takes one line from a reply: no heading marks, no fences, cut to the cap", () => {
    expect(firstSayingLine("\n## Plan\n1. x")).toBe("Plan");
    expect(firstSayingLine("```ts\nconst a = 1;\n```\nReal line.")).toBe("const a = 1;");
    expect(firstSayingLine("   \n\n")).toBeUndefined();
    expect(firstSayingLine("x".repeat(1_000))?.length).toBe(KODO_LOOP_CONCLUSION_MAX_CHARS);
    expect(clipLine("a  b\n c", 10)).toBe("a b c");
  });
});

describe("the loop's size in the thread payload", () => {
  const modelSelection = { instanceId: "i".repeat(40), model: "m".repeat(80) };
  const record = (round: number, stage: "plan" | "code" | "review" | "judge") =>
    KodoLoopStageRecord.make({
      round,
      stage,
      messageId: MessageId.make(`kodo-loop-${"c".repeat(60)}-r${round}-${stage}-a9`),
      runId: RunId.make(`run:${"r".repeat(60)}`),
      status: "completed",
      model: modelSelection as never,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:00.000Z",
      conclusion: "c".repeat(KODO_LOOP_CONCLUSION_MAX_CHARS),
      ...(stage === "judge" ? { verdict: compactVerdict(verdict(20)) } : {}),
      ...(stage === "review"
        ? { review: { parsed: true, verdict: "blocking" as const, findings: 30, high: 30 } }
        : {}),
    });

  it("is bounded at about 100 KB even at the most rounds, the most stages and every cap", () => {
    const stages = Array.from({ length: KODO_LOOP_MAX_ROUNDS }, (_, index) =>
      (["plan", "code", "review", "judge"] as const).map((stage) => record(index + 1, stage)),
    ).flat();
    expect(stages).toHaveLength(KODO_LOOP_MAX_ROUNDS * KODO_LOOP_STAGES_PER_ROUND);
    const loop = KodoLoop.make({
      ...testLoop({ maxRounds: KODO_LOOP_MAX_ROUNDS }),
      request: "q".repeat(20_000),
      stopDetail: "d".repeat(2_000),
      summary: "s".repeat(8_000),
      stages,
    });
    const bytes = new TextEncoder().encode(JSON.stringify(encodeLoop(loop))).length;
    // Before the records were cut to headlines the same loop was 2 to 3 MB.
    expect(bytes).toBeLessThan(110_000);
  });

  it("a typical three-round loop is a few kilobytes", () => {
    const stages = [1, 2, 3].flatMap((round) =>
      (["plan", "code", "review", "judge"] as const).map((stage) => ({
        ...record(round, stage),
        conclusion: "A short conclusion about what the stage found.",
        ...(stage === "judge" ? { verdict: compactVerdict(verdict(2)) } : {}),
      })),
    );
    const loop = KodoLoop.make({ ...testLoop(), stages });
    const bytes = new TextEncoder().encode(JSON.stringify(encodeLoop(loop))).length;
    expect(bytes).toBeLessThan(15_000);
  });

  it("refuses a record that carries what must be re-read from the thread", () => {
    const base = encodeRecord(record(1, "plan"));
    // Unknown keys such as the plan text are dropped on decode, never stored.
    expect(decodeRecord({ ...base, planMarkdown: "x".repeat(10_000) })).not.toHaveProperty(
      "planMarkdown",
    );
    expect(() =>
      decodeRecord({ ...base, conclusion: "x".repeat(KODO_LOOP_CONCLUSION_MAX_CHARS + 1) }),
    ).toThrow();
  });
});
