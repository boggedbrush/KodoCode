import { describe, expect, it } from "@effect/vitest";

import { kodoInboxApprovalCommand } from "./needsYouCommand";
import { threadEnvironment } from "../state/threads";

describe("the Needs you inbox's approvals", () => {
  it("are answered with the command the approval's own card uses, and no other", () => {
    expect(kodoInboxApprovalCommand).toBe(threadEnvironment.respondToApproval);
  });
});
