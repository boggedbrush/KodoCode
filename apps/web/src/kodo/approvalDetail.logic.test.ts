import { describe, expect, it } from "vite-plus/test";

import { kodoApprovalDetailView, kodoInboxApprovalView } from "./approvalDetail.logic";

describe("an approval's detail", () => {
  it("shows a short one whole, with nothing to expand", () => {
    const view = kodoApprovalDetailView("Project: acme\nMode: Code\nRequest: Fix it.", false);
    expect(view).toMatchObject({ collapsible: false, shown: expect.stringContaining("Fix it.") });
  });

  it.each([
    { name: "many lines", text: Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n") },
    { name: "one long line", text: "x".repeat(5_000) },
  ])("collapses $name to its start, and shows all of it once expanded", ({ text }) => {
    const collapsed = kodoApprovalDetailView(text, false);
    expect(collapsed.collapsible).toBe(true);
    expect(collapsed.shown.length).toBeLessThan(text.length);
    expect(text.startsWith(collapsed.shown)).toBe(true);
    const expanded = kodoApprovalDetailView(text, true);
    expect(expanded.shown).toBe(text);
    expect(expanded.totalChars).toBe(text.length);
  });
});

describe("what the inbox shows of an approval", () => {
  it("adds the app and the reason to the detail, and counts them toward the length limit", () => {
    const view = kodoInboxApprovalView({
      detail: "Allow access?",
      appName: "Calendar",
      reason: "Needs your events",
      requestKind: "permission",
    });
    expect(view).toEqual({
      text: "Allow access?\nCalendar\nNeeds your events",
      answerable: true,
    });
    const long = kodoInboxApprovalView({
      detail: "x".repeat(590),
      appName: "Calendar",
      reason: "y".repeat(20),
      requestKind: "permission",
    });
    expect(kodoApprovalDetailView(long.text, false).collapsible).toBe(true);
  });

  it.each([undefined, null, "", "  "])(
    "is not answerable from the inbox with detail %j",
    (detail) => {
      expect(
        kodoInboxApprovalView({ detail, appName: "Calendar", requestKind: "permission" }),
      ).toEqual({ text: "permission\nCalendar", answerable: false });
    },
  );
});
