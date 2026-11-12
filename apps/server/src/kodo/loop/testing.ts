// Builders shared by the loop's tests.
import {
  MessageId,
  RunId,
  type KodoLoop,
  type KodoLoopStageRecord,
  type KodoLoopVerdict,
  type KodoReviewResult,
} from "@t3tools/contracts";

export const verdictBlock = (body: object) => `\`\`\`kodo-verdict\n${JSON.stringify(body)}\n\`\`\``;
export const reviewBlock = (body: object) => `\`\`\`kodo-review\n${JSON.stringify(body)}\n\`\`\``;

export const completeVerdict: KodoLoopVerdict = {
  version: 1,
  complete: true,
  summary: "Everything asked for is there.",
  outstanding: [],
  approach: "",
};
export const incompleteVerdict: KodoLoopVerdict = {
  version: 1,
  complete: false,
  summary: "One thing is missing.",
  outstanding: [{ id: "o1", title: "No test", detail: "Nothing covers the new branch." }],
  approach: "Add the test, then run the checks.",
};
export const passReview: KodoReviewResult = {
  version: 1,
  verdict: "pass",
  summary: "Fine.",
  findings: [],
};

export const testLoop = (overrides: Partial<KodoLoop> = {}): KodoLoop => ({
  loopId: "L1",
  revision: 1,
  status: "active",
  round: 1,
  maxRounds: 3,
  stage: "plan",
  request: "Make the parser stricter.",
  requestMessageId: MessageId.make("m-request"),
  startMode: "code",
  planApproval: "auto",
  budget: { stopAtLimitPercent: 90 },
  baseline: {},
  stages: [],
  ...overrides,
});

export const testRecord = (
  overrides: Partial<KodoLoopStageRecord> & Pick<KodoLoopStageRecord, "round" | "stage">,
): KodoLoopStageRecord => ({
  messageId: MessageId.make(`kodo-loop-L1-r${overrides.round}-${overrides.stage}`),
  runId: RunId.make(`run-${overrides.round}-${overrides.stage}`),
  status: "completed",
  model: null,
  startedAt: "2026-01-01T00:00:00.000Z",
  completedAt: "2026-01-01T00:01:00.000Z",
  ...overrides,
});
