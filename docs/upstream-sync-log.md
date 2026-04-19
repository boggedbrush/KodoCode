# Upstream Sync Log

## 2026-04-19

- Fork branch: `sync/upstream-2026-04-17`
- Fork base: `boggedbrush/KodoCode@adf75c663ced736d0807242a041f67dc699aecad`
- Upstream range reviewed: `pingdotgg/t3code@9df3c640210fecccb58f7fbc735f81ca0ee011bd..9df3c640210fecccb58f7fbc735f81ca0ee011bd`
- Upstream release window: `main unchanged since 2026-04-18 review`
- Fork PR: https://github.com/boggedbrush/KodoCode/pull/7

### Classification

- No new upstream `main` commits were available after `9df3c640`, so there were no new `APPLY`, `ADAPT`, `SELECTIVE FRONTEND`, `MANUAL REVIEW`, or `SKIP` classifications in this run.
- User-requested follow-up: `44afe784` `Add filesystem browse API and command palette project picker (#2024)` — `ADAPT`: ported the backend filesystem browse API and a focused Sidebar folder browser without importing upstream command-palette or project-flow churn.

### Applied changes

- None. Upstream `main` had no new commits beyond the previously reviewed boundary.
- Local branch follow-up: repaired sync-branch typecheck drift caused by Effect cache API and branded-id helper changes so required validation passes cleanly.
- Added `filesystem.browse` contracts/RPC wiring and server-side directory browsing through `WorkspaceEntries`.
- Added a Kodo-specific inline folder browser to the Sidebar add-project flow so desktop users are no longer forced through the system folder picker.

### Adapted changes

- `44afe784` selectively adapted:
- kept the browse backend/API pieces
- omitted the upstream command palette and project picker architecture
- wired the feature into Kodo's existing Sidebar add-project UI instead

### Selective frontend changes ported

- None.

### Manual-review candidates

- `8dba2d64` Node-native TypeScript adoption: still too broad for a bounded sync.
- `a7a44d06` Windows PATH hydration/repair: still valuable, but remains a large shared-runtime adaptation.
- `40009735` Backend startup readiness extraction: still overlaps Kodo desktop startup policy.
- `4e0c003e` Non-empty project deletion flow: still a mixed server/client workflow needing product review.

### Skipped changes

- None newly skipped in this run because there were no new upstream commits to classify.

### Deferred selective frontend candidates

- `39ca3ee8` Global terminal shortcuts from focused xterm: still deferred; looks safe for a future PR.
- `60387f67` Restore-defaults button limited to General settings: still deferred pending visual review against Kodo settings divergence.

### Checks

- `bun fmt` ✅
- `bun lint` ✅
- `bun typecheck` ✅
- `cd apps/server && bun run test src/workspace/Layers/WorkspaceEntries.test.ts -t browse` ✅
- `cd apps/server && bun run test src/server.test.ts -t filesystem.browse` ✅
- `cd apps/web && bun run test src/wsNativeApi.test.ts src/lib/projectPaths.test.ts` ✅

## 2026-04-18

- Fork branch: `sync/upstream-2026-04-17`
- Fork base: `boggedbrush/KodoCode@be7628c915e6db187efe26328bedc62fedba0c76`
- Upstream range reviewed: `pingdotgg/t3code@2d87574e62d616d890497d5b7d48201aa06d4dce..9df3c640210fecccb58f7fbc735f81ca0ee011bd`
- Upstream release window: `v0.0.20..main@2026-04-17`
- Fork PR: https://github.com/boggedbrush/KodoCode/pull/7

### Classification

- `2d87574e` `chore(release): prepare v0.0.20` — `SKIP`: release version churn only.
- `505db9f6` `try out blacksmith for releases (#2101)` — `SKIP`: release pipeline divergence.
- `b991b9b9` `Revert to Github Runner for Windows (#2103)` — `SKIP`: release pipeline divergence.
- `ed6b7fbf` `fix(server): honor gitignored files in workspace search (#2078)` — `ADAPT`: ported the server-layer wiring and focused regression test without upstream harness churn.
- `8dba2d64` `Adopt Node-native TypeScript for desktop and server (#2098)` — `MANUAL`: broad tooling/runtime refactor across desktop, server, scripts, and contracts.
- `54179c86` `Update workflow to use ubuntu-24.04 runner (#2110)` — `SKIP`: release/CI runner policy is out of scope for this sync.
- `d8d32969` `Show thread status in command palette (#2107)` — `SKIP`: command-palette UI expansion conflicts with Kodo workflow boundaries.
- `a7a44d06` `Fix Windows PATH hydration and repair (#1729)` — `MANUAL`: valuable runtime hardening, but large shared shell/runtime rewrite on top of prior sync work.
- `f297e30e` `Clean up invalid pending approval projections (#2106)` — `APPLY`
- `df9d3400` `Modernize release workflow runners (#2129)` — `SKIP`: release workflow divergence.
- `40009735` `Extract backend startup readiness coordination (#2133)` — `MANUAL`: desktop startup refactor touches Kodo-specific startup/runtime behavior.
- `721b6b4c` `Preserve provider bindings when stopping sessions (#2125)` — `ADAPT`: ported the provider-binding persistence fix while keeping Kodo’s current tests and session scaffolding.
- `52a60678` `Throttle nightly release workflow to every 3 hours (#2134)` — `SKIP`: nightly release policy divergence.
- `39ca3ee8` `fix(web): bypass xterm for global terminal shortcuts (#1580)` — `SELECTIVE FRONTEND`: safe candidate, but deferred to keep this batch narrow after landing the higher-value terminal toggle fix.
- `ce94feee` `feat: add opencode provider support (#1758)` — `SKIP`: large new provider/product surface outside bounded sync scope.
- `60387f67` `fix: show restore defaults only on General settings (#1710)` — `SELECTIVE FRONTEND`: safe candidate, but deferred because it touches Kodo-owned settings surfacing and is lower priority than runtime work.
- `4e0c003e` `fix(web): allow deleting non-empty projects from the warning toast (#1264)` — `MANUAL`: mixed server/client project-deletion workflow change needs Kodo product judgment.
- `a3b1df52` `Add Claude Opus 4.5 to built-in Claude models (#2143)` — `SKIP`: visible provider/model surface change.
- `0f184c28` `fix(web): use capture-phase keydown listener so CTRL+J toggles terminal from terminal focus on Windows (#2113) (#2142)` — `SELECTIVE FRONTEND`
- `9c64f12e` `Add ACP support with Cursor provider (#1355)` — `SKIP`: major new provider/runtime architecture and package surface.
- `29cb917a` `Guard release workflow jobs from upstream failures (#2146)` — `SKIP`: release workflow divergence.
- `8ac57f79` `Guard release workflow jobs on upstream success (#2147)` — `SKIP`: release workflow divergence.
- `9df3c640` `Use GitHub App token for release uploads (#2149)` — `SKIP`: release workflow divergence.

### Applied changes

- `f297e30e` Added migration `025_CleanupInvalidProjectionPendingApprovals` to scrub invalid persisted pending-approval rows.
- Restored missing local migration file `023_ProjectionThreadShellSummary` from Kodo history so the sync branch’s migration registry is internally consistent.

### Adapted changes

- `ed6b7fbf` Wired `WorkspaceEntries` through `GitCore` in [`apps/server/src/server.ts`](/mnt/c/Users/Admin/.codex/worktrees/b83f/KodoCode/apps/server/src/server.ts) and added a regression test in [`apps/server/src/server.test.ts`](/mnt/c/Users/Admin/.codex/worktrees/b83f/KodoCode/apps/server/src/server.test.ts) so workspace search respects gitignored paths.
- `721b6b4c` Updated provider stop-session handling in [`apps/server/src/provider/Layers/ProviderService.ts`](/mnt/c/Users/Admin/.codex/worktrees/b83f/KodoCode/apps/server/src/provider/Layers/ProviderService.ts) and [`apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`](/mnt/c/Users/Admin/.codex/worktrees/b83f/KodoCode/apps/server/src/orchestration/Layers/ProviderCommandReactor.ts) to preserve provider bindings after stop/restart cycles.

### Selective frontend changes ported

- `0f184c28` Updated [`apps/web/src/components/ChatView.tsx`](/mnt/c/Users/Admin/.codex/worktrees/b83f/KodoCode/apps/web/src/components/ChatView.tsx) so the terminal toggle shortcut is captured while terminal focus is inside xterm on Windows, with regression coverage in [`apps/web/src/keybindings.test.ts`](/mnt/c/Users/Admin/.codex/worktrees/b83f/KodoCode/apps/web/src/keybindings.test.ts).

### Manual-review candidates

- `8dba2d64` Node-native TypeScript adoption: too broad for a bounded sync.
- `a7a44d06` Windows PATH hydration/repair: valuable, but large shared-runtime adaptation.
- `40009735` Backend startup readiness extraction: overlaps Kodo desktop startup policy.
- `4e0c003e` Non-empty project deletion flow: mixed server/client workflow needs product review.

### Skipped changes

- Release workflow and packaging changes: `2d87574e`, `505db9f6`, `b991b9b9`, `54179c86`, `df9d3400`, `52a60678`, `29cb917a`, `8ac57f79`, `9df3c640`
- Product-surface/provider expansions: `ce94feee`, `a3b1df52`, `9c64f12e`
- Command-palette UI expansion: `d8d32969`

### Deferred selective frontend candidates

- `39ca3ee8` Global terminal shortcuts from focused xterm: deferred after landing the narrower Ctrl+J fix first; looks safe for a future PR.
- `60387f67` Restore-defaults button limited to General settings: deferred because Kodo’s settings surface is already diverging; likely safe for a future PR with visual review.

### Checks

- `bun fmt` ✅
- `bun lint` ✅
- `bun typecheck` ⚠️ fails in pre-existing `apps/web` Base UI / `ButtonProps` typing errors unrelated to this sync batch.
- `cd apps/web && bun run test src/keybindings.test.ts` ✅
- `cd apps/server && bun run test ...` ⚠️ blocked by pre-existing server test environment issues: missing `multipasta/node` resolution and missing migration `023` before the local restore commit.

## 2026-04-17

- Fork branch: `sync/upstream-2026-04-17`
- Fork base: `boggedbrush/KodoCode@9eb9c1a9`
- Upstream range reviewed: `pingdotgg/t3code@e3004ae806d4e9a81e03ff919f50d2d34c37ffe7..b2cca674dfdf93430460fe08e1ce0d857e30bd83`
- Upstream release window: `v0.0.17..v0.0.20`
- Fork PR: https://github.com/boggedbrush/KodoCode/pull/7

### Classification

- `a3dadf31` `chore(release): prepare v0.0.17` — `SKIP`: upstream release-prep version churn only.
- `678f827f` `Remove Claude subscription-based model adjustment (#1899)` — `APPLY`
- `e2316814` `Fix worktree base branch updates for active draft (#1900)` — `SKIP`: workflow/UI-coupled draft branch behavior.
- `12c3af78` `feat(desktop): add "Copy Image" to right-click context menu (#1052)` — `SKIP`: desktop UI feature.
- `5fa09fa2` `[codex] fix composer footer compact layout (#1894)` — `SKIP`: web UI layout.
- `4ae9de31` `Stabilize auth session cookies per server mode (#1898)` — `MANUAL`: valuable auth hardening, but conflicted with Kodo auth/desktop runtime changes across multiple files.
- `58e5f714` `Add provider skill discovery (#1905)` — `MANUAL`: backend value exists, but upstream implementation is tightly coupled to composer/menu UI surfaces.
- `e0e01b4a` `Handle deleted git directories as non-repositories (#1907)` — `APPLY`
- `b80e8476` `Memoize derived thread reads (#1908)` — `SKIP`: frontend state/render optimization.
- `97880e88` `fix(web): resolve logical-to-physical key mismatch in project drag reorder (#1904)` — `SKIP`: web UI interaction.
- `26cc1fff` `Add assistant message copy action and harden related test/storage fallbacks (#1211)` — `SKIP`: chat UI feature.
- `1f4a3f65` `Fix opening urls wrapped across lines in the terminal (#1913)` — `SKIP`: terminal/web presentation behavior.
- `5467d119` `fix(web): prevent number-key shortcuts from hijacking input in focused editor (#1810)` — `SKIP`: web editor UX.
- `934037cb` `feat(web): add extensible command palette (#1103)` — `SKIP`: command-palette UI dominates the mixed change.
- `f9372a4c` `chore(desktop): separate dev AppUserModelID on Windows (#1934)` — `SKIP`: desktop shell presentation/platform polish.
- `f9019cd6` `Coalesce status refreshes by remote (#1940)` — `MANUAL`: adapted to keep Kodo non-interactive git hardening while porting the refresh-coalescing fix.
- `2fce84a1` `fix: quote editor launch args on Windows to support paths with spaces (#1805)` — `APPLY`
- `f59ee36b` `fix(web): allow concurrent browser tests to retry ports (#1951)` — `SKIP`: browser-test harness only.
- `7a008461` `fix: Align token usage metrics for both Claude and Codex (#1943)` — `APPLY`
- `94d13a2b` `Preserve live stream subscriptions across explicit reconnects (#1972)` — `SKIP`: reconnect UX/runtime mix touches frontend behavior.
- `96c9306d` `Migrate chat scrolling and branch lists to LegendList (#1953)` — `SKIP`: frontend virtualization/list rendering.
- `dff8784a` `window controls overlay (windows&linux) (#1969)` — `SKIP`: desktop/web presentation.
- `850c9125` `fix(desktop): increase backend readiness timeout from 10s to 30s (#1979)` — `SKIP`: desktop startup policy change conflicts with Kodo release/runtime path.
- `57d7746a` `fix(web): replace turn strip overlay gradients with mask-image fade (#1949)` — `SKIP`: styling.
- `f7fa62aa` `Add shell snapshot queries for orchestration state (#1973)` — `MANUAL`: backend value exists, but not needed for this batch.
- `1bf048eb` `fix: avoid copy button overlapping long code blocks (#1985)` — `SKIP`: chat UI.
- `f2205bdc` `Pad composer model picker to prevent ring clipping (#1992)` — `SKIP`: styling/layout.
- `801b83e9` `Allow empty server threads to bootstrap new worktrees (#1936)` — `SKIP`: mixed commit heavily coupled to branch-toolbar and chat UI.
- `77fcad35` `Prevent live thread branches from regressing to temp worktree names (#1995)` — `SKIP`: thread/branch presentation coupling.
- `047a0a69` `fix: add pointer cursor to the permissions mode select trigger (#1997)` — `SKIP`: styling.
- `9b29be91` `docs: Document environment prep before local development (#1975)` — `SKIP`: docs only.
- `5f7becf3` `feat: Add Kiro editor support to open picker (#1974)` — `APPLY`
- `cadd7086` `feat: show full thread title in a tooltip when hovering sidebar thread names (#1994)` — `SKIP`: sidebar UI.
- `f5ecca44` `Clear tracked RPCs on reconnect (#2000)` — `SKIP`: frontend reconnect behavior.
- `6f699346` `Use latest user message time for thread timestamps (#1996)` — `SKIP`: thread list UX.
- `d18e43b6` `fix: lost provider session recovery (#1938)` — `APPLY`
- `33dadb5a` `Fix thread timeline autoscroll and simplify branch state (#2002)` — `SKIP`: thread timeline UX.
- `569fea87` `Warm sidebar thread detail subscriptions (#2001)` — `SKIP`: sidebar performance/UI behavior.
- `5f7ec73a` `Fix new-thread draft reuse for worktree defaults (#2003)` — `SKIP`: new-thread frontend flow.
- `9dcea68b` `Refresh git status after branch rename and worktree setup (#2005)` — `MANUAL`: runtime fix applied while preserving Kodo server-test scaffolding.
- `008ac5c3` `Cache provider status and gate desktop startup (#1962)` — `MANUAL`: mixed startup/runtime change deferred because it conflicts with Kodo desktop startup behavior.
- `2e42f3fd` `Improve shell PATH hydration and fallback detection (#1799)` — `APPLY`
- `c9b07d66` `Backfill projected shell summaries and stale approval cleanup (#2004)` — `MANUAL`: projection and migration changes merged into Kodo persistence state.
- `0d280262` `fix(claude): emit plan events for TodoWrite during input streaming (#1541)` — `SKIP`: upstream plan/composer UI coupling.
- `409ff90a` `Nightly release channel (#2012)` — `SKIP`: release channel/branding flow diverges in Kodo.
- `9ff31f8c` `Fix nightly desktop product name (#2025)` — `SKIP`: nightly branding.
- `44afe784` `Add filesystem browse API and command palette project picker (#2024)` — `MANUAL`: backend browse API may be useful later, but the commit is tied to upstream command-palette UI and project-creation flow.
- `7968f278` `Fix terminal Cmd+Backspace on macOS (#2027)` — `SKIP`: frontend terminal UX.
- `28cb9db2` `feat(web): add tooltip to composer file mention pill (#1944)` — `SKIP`: UI.
- `68061af0` `Improve markdown file link UX (#1956)` — `SKIP`: frontend markdown UX.
- `5e1dd56d` `feat: add Launch Args setting for Claude provider (#1971)` — `SKIP`: settings-surface/UI coupling.
- `f9580ff0` `Default nightly desktop builds to the nightly update channel (#2049)` — `SKIP`: nightly packaging policy differs in Kodo.
- `5e13f535` `fix: remove trailing newline from CLAUDE.md symlink (#2052)` — `SKIP`: low-value repo housekeeping outside sync priorities.
- `d22c6f52` `fix: prevent user-input activities from leaking into pending approvals projection (#2051)` — `APPLY`
- `3e07f5a6` `feat: add Claude Opus 4.7 to built-in models (#2072)` — `SKIP`: visible provider/model surface change.
- `19d47408` `fix(web): prevent composer controls overlap on narrow windows (make plan sidebar responsive) (#1198)` — `SKIP`: responsive UI.
- `7a08fcf2` `fix(server): drop stale text generation options when resetting text-gen model selection (#2076)` — `MANUAL`: skipped because upstream settings model is behind Kodo’s preset/settings evolution.
- `188a40c3` `feat: configurable project grouping (#2055)` — `SKIP`: project grouping is a user-visible workflow/settings surface.
- `e0117b27` `Fix Claude Process leak[MEMORY INTENSIVE], archiving, and stale claude session monitoring. (#2042)` — `MANUAL`: large runtime/session rewrite deferred due extensive conflicts.
- `d90e15d1` `fix(server): extend negative repository identity cache ttl (#2083)` — `APPLY`
- `6891c77d` `Build for Windows ARM (#2080)` — `SKIP`: release/build pipeline conflicts with Kodo packaging changes.
- `b7df3dfc` `[codex] Fix Windows release manifest publishing (#2095)` — `SKIP`: release pipeline divergence.
- `54904386` `fix: guard against missing sidebarProjectGroupingOverrides in client settings (#2099)` — `SKIP`: client settings/frontend behavior.
- `b2cca674` `ci(release): install deps before finalize version bump (#2100)` — `SKIP`: release workflow divergence.
