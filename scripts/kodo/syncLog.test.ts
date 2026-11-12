import { assert, describe, it } from "@effect/vitest";

import { insertSyncLogEntry, renderSyncLogEntry, type SyncLogEntry } from "./syncLog.ts";

const entry: SyncLogEntry = {
  date: "2026-12-01",
  branch: "sync/upstream-2026-12-01",
  forkRepo: "fork/app",
  forkBase: "1111111111111111111111111111111111111111",
  upstreamRepo: "up/app",
  upstreamRef: "upstream/main",
  rangeFrom: "2222222222222222222222222222222222222222",
  rangeTo: "3333333333333333333333333333333333333333",
  commitCount: 42,
  autoResolved: [{ path: "kodo/a.ts", why: "Kodo-owned path" }],
  resolvedByHand: ["src/x.ts"],
  applyResults: [
    { section: "replacement", id: "name", status: "applied", details: [] },
    { section: "asset", id: "icon", status: "target-missing", details: ['assets "icon": moved'] },
  ],
  applyChangedFiles: ["src/a.tsx"],
  hooks: [{ file: "a.ts", status: "ok", missing: [], details: [] }],
  leaks: [{ checkId: "brand", status: "ok", fileCount: 3, allowedCount: 0, hits: [], details: [] }],
  ownedViolations: [{ file: "kodo/up.ts", owned: "kodo/" }],
  checkProblems: [],
  verification: [{ name: "vp test run", ok: false, detail: "exit 1" }],
  verificationSkipped: false,
  reviewItems: ["new provider package provider-x added upstream."],
  followUps: ["Reinstall."],
};

describe("sync log", () => {
  it("renders the range, resolutions, results and follow-ups", () => {
    const text = renderSyncLogEntry(entry);
    assert.include(text, "## 2026-12-01\n");
    assert.include(text, "`up/app@2222222222..3333333333` (upstream/main), 42 commits");
    assert.include(text, "- `kodo/a.ts`: Kodo-owned path");
    assert.include(text, "### Resolved by hand\n\n- `src/x.ts`");
    assert.include(text, "- Entries: 1 applied, 1 target-missing.");
    assert.include(text, "- `src/a.tsx`");
    assert.include(text, "- Required hooks: 1/1 files intact.");
    assert.include(text, "- Leak checks: 1/1 clean.");
    assert.include(text, "Warning: upstream now ships `kodo/up.ts` inside Kodo-owned `kodo/`.");
    assert.include(text, "- `kodo:check`: pass.");
    assert.include(text, "- `vp test run`: FAIL (exit 1)");
    assert.include(text, "### Follow-ups\n\n- Reinstall.");
  });

  it("states the outcome at the top and lists what needs a human look", () => {
    const failed = renderSyncLogEntry(entry);
    assert.include(failed, "- Result: **NOT READY**: `vp test run` failed. Do not release");
    assert.include(failed, "### Needs a human look\n\n- new provider package provider-x");
    const checkFailed = renderSyncLogEntry({
      ...entry,
      checkProblems: ["x is a test file the layer touches"],
      verification: [],
    });
    assert.include(checkFailed, "**NOT READY**: `kodo:check` (1 problem line(s)) failed");
    const skipped = renderSyncLogEntry({ ...entry, verification: [], verificationSkipped: true });
    assert.include(skipped, "**NOT READY**: verification was skipped");
    const ready = renderSyncLogEntry({ ...entry, verification: [], reviewItems: [] });
    assert.include(ready, "- Result: Ready: check and every verification command passed.");
    assert.notInclude(ready, "Needs a human look");
  });

  it("inserts newest first under the title and creates a missing log", () => {
    const rendered = renderSyncLogEntry(entry);
    const merged = insertSyncLogEntry("# Upstream Sync Log\n\n## 2026-11-12\n\n- old\n", rendered);
    assert.isTrue(merged.startsWith("# Upstream Sync Log\n\n## 2026-12-01\n"));
    assert.isTrue(merged.endsWith("## 2026-11-12\n\n- old\n"));
    assert.isTrue(
      insertSyncLogEntry("", rendered).startsWith("# Upstream Sync Log\n\n## 2026-12-01"),
    );
  });
});
