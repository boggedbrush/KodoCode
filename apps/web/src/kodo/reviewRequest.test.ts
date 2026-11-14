import { describe, expect, it } from "@effect/vitest";

import {
  hasKodoReviewRequest,
  kodoReviewOffered,
  registerKodoReviewRequest,
  requestKodoReview,
} from "./reviewRequest";

const OFFERED = {
  isServerThread: true,
  canOperateThread: true,
  isWorker: false,
  isOrchestrator: false,
  isSendBusy: false,
  modeLocked: false,
};

describe("when a thread offers Review on a turn's changes", () => {
  it("does for an ordinary idle thread", () => {
    expect(kodoReviewOffered(OFFERED)).toBe(true);
  });

  it.each([
    ["a worker", { isWorker: true }],
    ["the Orchestrator", { isOrchestrator: true }],
    ["a turn that is running", { isSendBusy: true }],
    ["a loop that holds the mode", { modeLocked: true }],
    ["a draft", { isServerThread: false }],
    ["a thread a person cannot act on", { canOperateThread: false }],
  ])("does not for %s", (_name, over) => {
    expect(kodoReviewOffered({ ...OFFERED, ...over })).toBe(false);
  });
});

describe("asking for the review", () => {
  it("reaches only the thread that registered, and says so when none did", () => {
    let opened = 0;
    expect(requestKodoReview("a")).toBe(false);
    const dispose = registerKodoReviewRequest("a", () => {
      opened += 1;
    });
    expect(hasKodoReviewRequest("a")).toBe(true);
    expect(requestKodoReview("b")).toBe(false);
    expect(requestKodoReview("a")).toBe(true);
    expect(opened).toBe(1);
    dispose();
    expect(hasKodoReviewRequest("a")).toBe(false);
  });
});
