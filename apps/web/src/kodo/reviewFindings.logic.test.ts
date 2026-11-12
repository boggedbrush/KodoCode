import { describe, expect, it } from "@effect/vitest";
import type { KodoReviewFinding, KodoReviewResult } from "@t3tools/contracts";

import {
  buildFindingsFixTurn,
  canFixFindings,
  findKodoFindingsOffer,
  kodoFindingLocation,
  kodoFindingsTitle,
  shouldShowFindingsCard,
  sortKodoFindings,
} from "./reviewFindings.logic";

const finding = (over: Partial<KodoReviewFinding> & Pick<KodoReviewFinding, "id" | "severity">) =>
  ({
    title: `Finding ${over.id}`,
    detail: `Detail ${over.id}.`,
    ...over,
  }) satisfies KodoReviewFinding;

const review = (
  verdict: KodoReviewResult["verdict"],
  findings: ReadonlyArray<KodoReviewFinding>,
): KodoReviewResult => ({ version: 1, verdict, summary: "Reviewed the diff.", findings });

const reply = (body: KodoReviewResult) =>
  `The change looks mostly sound.\n\n\`\`\`kodo-review\n${JSON.stringify(body)}\n\`\`\`\n`;

const concerns = review("concerns", [finding({ id: "a", severity: "medium" })]);

const offerFor = (
  over: {
    status?: string;
    mode?: "review" | "code" | "plan" | "ask" | "default" | undefined;
    text?: string | null;
    assistantMessageId?: string | null;
    omitRun?: boolean;
  } = {},
) =>
  findKodoFindingsOffer({
    latestRun: {
      runId: "run-1",
      status: over.status ?? "completed",
      assistantMessageId: over.assistantMessageId === undefined ? "msg-1" : over.assistantMessageId,
    },
    runs: over.omitRun
      ? []
      : [{ id: "run-1", interactionMode: "mode" in over ? over.mode : "review" }],
    messageText: () => (over.text === undefined ? reply(concerns) : over.text),
  });

describe("findKodoFindingsOffer", () => {
  it("offers the findings of a settled Review run whose reply ends with a valid block", () => {
    expect(offerFor()).toEqual({
      key: "run:run-1",
      runId: "run-1",
      messageId: "msg-1",
      review: concerns,
    });
  });

  it.each([
    [
      "no latest run",
      () => findKodoFindingsOffer({ latestRun: null, runs: [], messageText: () => null }),
    ],
    ["a run still going", () => offerFor({ status: "running" })],
    ["a failed run", () => offerFor({ status: "failed" })],
    ["a run with no reply", () => offerFor({ assistantMessageId: null })],
    ["a reply that is missing", () => offerFor({ text: null })],
    ["a Code-mode run", () => offerFor({ mode: "code" })],
    ["a Plan-mode run", () => offerFor({ mode: "plan" })],
    ["a run that recorded no mode", () => offerFor({ mode: undefined })],
    ["a run that is not in the list", () => offerFor({ omitRun: true })],
    ["a reply without the block", () => offerFor({ text: "Looks good to me." })],
    ["a block that is not JSON", () => offerFor({ text: "```kodo-review\n{oops\n```" })],
    [
      "a verdict that contradicts its findings",
      () => offerFor({ text: reply(review("blocking", [finding({ id: "a", severity: "low" })])) }),
    ],
    [
      "a verdict block where a review is wanted",
      () => offerFor({ text: "```kodo-verdict\n{}\n```" }),
    ],
  ])("offers nothing for %s", (_name, make) => {
    expect(make()).toBeNull();
  });

  it("reads a legacy default mode as code, so it offers nothing", () => {
    expect(offerFor({ mode: "default" })).toBeNull();
  });
});

describe("findings display", () => {
  it("sorts by severity and keeps the reviewer's order within one", () => {
    const sorted = sortKodoFindings([
      finding({ id: "l1", severity: "low" }),
      finding({ id: "m1", severity: "medium" }),
      finding({ id: "h1", severity: "high" }),
      finding({ id: "m2", severity: "medium" }),
      finding({ id: "h2", severity: "high" }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["h1", "h2", "m1", "m2", "l1"]);
  });

  it.each([
    [finding({ id: "a", severity: "low", file: "src/a.ts", line: 12 }), "src/a.ts:12"],
    [finding({ id: "a", severity: "low", file: "src/a.ts" }), "src/a.ts"],
    [finding({ id: "a", severity: "low" }), null],
    [finding({ id: "a", severity: "low", line: 3 }), null],
  ])("locates %j as %s", (entry, expected) => {
    expect(kodoFindingLocation(entry)).toBe(expected);
  });

  it.each([
    [review("pass", []), "Review passed"],
    [review("pass", [finding({ id: "a", severity: "low" })]), "Review found 1 finding"],
    [
      review("concerns", [
        finding({ id: "a", severity: "medium" }),
        finding({ id: "b", severity: "low" }),
      ]),
      "Review found 2 findings",
    ],
    [
      review("blocking", [
        finding({ id: "a", severity: "high" }),
        finding({ id: "b", severity: "high" }),
        finding({ id: "c", severity: "low" }),
      ]),
      "Review found 3 findings, 2 blocking",
    ],
  ])("titles %j as %s", (value, expected) => {
    expect(kodoFindingsTitle(value)).toBe(expected);
  });
});

describe("buildFindingsFixTurn", () => {
  it("is a Code turn that lists every finding, most serious first, with where and how to fix", () => {
    const turn = buildFindingsFixTurn(
      review("blocking", [
        finding({ id: "l", severity: "low", title: "Typo", detail: "Misspelled name." }),
        finding({
          id: "h",
          severity: "high",
          title: "Off by one",
          file: "src/a.ts",
          line: 9,
          detail: "Skips the last item.",
          fix: "Use <=.",
        }),
      ]),
    );
    expect(turn.interactionMode).toBe("code");
    expect(turn.text).toContain(
      "1. [high] Off by one (src/a.ts:9)\n   Skips the last item.\n   Suggested fix: Use <=.",
    );
    expect(turn.text).toContain("2. [low] Typo\n   Misspelled name.");
    expect(turn.text.indexOf("Off by one")).toBeLessThan(turn.text.indexOf("Typo"));
    expect(turn.text).toContain("if a finding is wrong, say so");
  });
});

describe("card and action availability", () => {
  const offer = offerFor();
  const open = {
    offer,
    dismissedOfferKey: null,
    latestRunSettled: true,
    pendingUserInputCount: 0,
    canOperateThread: true,
  };

  it("shows until dismissed, and a dismissal does not hide the next review", () => {
    expect(shouldShowFindingsCard({ offer, dismissedOfferKey: null })).toBe(true);
    expect(shouldShowFindingsCard({ offer, dismissedOfferKey: "run:run-1" })).toBe(false);
    expect(shouldShowFindingsCard({ offer, dismissedOfferKey: "run:run-0" })).toBe(true);
    expect(shouldShowFindingsCard({ offer: null, dismissedOfferKey: null })).toBe(false);
  });

  it("lets Fix in Code start only for an operable, idle thread with something to fix", () => {
    expect(canFixFindings(open)).toBe(true);
    expect(canFixFindings({ ...open, canOperateThread: false })).toBe(false);
    expect(canFixFindings({ ...open, latestRunSettled: false })).toBe(false);
    expect(canFixFindings({ ...open, pendingUserInputCount: 1 })).toBe(false);
    expect(canFixFindings({ ...open, dismissedOfferKey: "run:run-1" })).toBe(false);
    expect(canFixFindings({ ...open, offer: null })).toBe(false);
    const clean = offerFor({ text: reply(review("pass", [])) });
    expect(canFixFindings({ ...open, offer: clean })).toBe(false);
  });
});
