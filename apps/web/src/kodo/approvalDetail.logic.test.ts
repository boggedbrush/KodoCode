import { describe, expect, it } from "vite-plus/test";

import { kodoApprovalDetailView } from "./approvalDetail.logic";

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
