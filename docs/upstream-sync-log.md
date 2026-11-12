# Upstream Sync Log

## 2026-11-12

- Fork branch: `claude/adoring-einstein-qckj4w`; the layer was re-based on `rebase-v0.1.9`.
- Previous fork base: `boggedbrush/KodoCode@1cab00de94` (preserved as git tag `kodo-legacy-2026-05`)
- Upstream adopted: stable release `v0.1.9` (`pingdotgg/t3code@24e77473ec`). The layer was first developed against upstream `main` at `3a30b011c3` (2026-11-11), which is 382 commits past the release, and then re-based onto `v0.1.9` as a single squashed layer commit (`e3d1a1ba29`). Kodo tracks stable releases only, so `main` is never merged.
- Strategy change: cherry-picking upstream commits is replaced by adopting upstream wholesale. A merge commit takes the release tree and records upstream as a merge parent, so future syncs are `pnpm kodo:sync` to the next stable tag.
- Kodo layer: branding and visual design (GNOME-styled default theme), the ask, plan, code, and review interaction modes with read-only enforcement, and the prompt Enhance button, re-applied on top of the release tree. The legacy tree is at `/home/user/kodo-legacy` for reference.
- Toolchain: moved from bun/turbo to pnpm 12.14.0, Node 26.12.1, and `vp` (Vite+) 1.4.0; the release pins the same versions.
- Kodo-only features not yet re-ported:
  - swarm mode
  - provider usage/quota polling
  - `/init`
  - in-app project folder browser
  - per-mode model/effort settings
  - review setup dialog and report card
  - Kodo desktop release/patch workflows

### Re-base onto v0.1.9: dropped or changed

Layer edits that sat on code that exists only on upstream `main` (after `v0.1.9`) were dropped or re-fitted:

- `apps/desktop/src/backend/DesktopHomeOwner.ts` does not exist in the release, so its brand edit is dropped. The equivalent "Another T3 Code server ..." message lives in `DesktopBackendPool.ts` in the release and is rewritten there by the brand codemod.
- `apps/server/src/project/AgentSessionImporter.ts`: the `mode-resolver` edit lived inside `importNativeHistory`, which the release does not have (native history import of ACP sessions is a later upstream feature). The file is the release's, unchanged, and the hook is removed from the manifest. Imported threads are created with the legacy `"default"` mode, which reads as Code.
- `apps/server/src/mcp/McpToolAccess.ts`: the `afterForwarding` wrapper (with its read-only guard) is dropped; the release has no `afterForwarding`.
- `apps/web`: the release has no `resolveHostedAppChannelLabel`/`resolveWebAppStageLabel` helpers or the title-stamping Vite plugin. The Alpha stage label moved to `branding.ts` (hook `stable-build`), `index.html` carries the static title `Kodo Code (Alpha)`, the `brand-name-define` hook is dropped, and `branding.logic.ts` is the release's file.
- `apps/web/src/components/ChatView.tsx`, `chat/ChatComposer.tsx`: the release's composer has no `canSteer` prop (it derives it from `isCompacting`), so the rule that a mode picked mid-turn must not steer into the running turn is applied inside `ChatComposer` through the mode status context. The mode slash command is handled before the send guards and, as on `main`, an open question still takes the text as its answer.
- `apps/web/src/components/chat/useComposerSend.ts`: `linkCheckoutPullRequest` does not exist in the release and is not carried.
- `apps/web/src/components/AppSidebarLayout.tsx`: `useMobileSidebarSheetMounted` is `main` only and is not carried.
- `apps/web/src/components/settings/ProjectSettingsPanel.logic.test.ts`: the `scopeProjectSettingsGroup` tests belong to a later upstream fix and are not carried.
- `apps/mobile/src/state/thread-outbox-model.ts` and its test: re-fitted to the release, which has no implicit-Fast model selection; the send keeps the thread's own mode (`mode-preserve`).
- `apps/desktop/src/app/DesktopPreReadyPlatform.test.ts`: the release copies the icon out of the app bundle; the later byte-write fix is not carried.
- `scripts/build-desktop-artifact.ts`: the release's `StartupWMClass` is `t3code`; Kodo keeps its own value (the app id), which matches what Electron reports for the desktop name and is also what upstream later changed to for its own id. The window-class test was added back with the Kodo package identity assertions.

### Checks

- Re-base verification: typecheck of contracts, shared, provider-core, the provider packages, client-runtime, server, web, desktop, mobile, scripts and evals; format, lint, `kodo:check`, `kodo:apply` (no-op); tests for contracts, shared, client-runtime, provider-core and provider packages, desktop, mobile, scripts, evals, and the server `kodo`, `mcp`, `peer`, `project`, `provider`, `telemetry` and `orchestration-v2` suites; the web unit project. Known environmental failures: `browser-secret-native.test.mjs` (libsecret), two `RepositoryIdentityResolver` tests (git URL rewrite), and 5 s timeouts in three scripts tests that pass with a longer timeout. Web browser-project tests were not run (no headless Chromium shell on this machine).
- Run `pnpm kodo:status --record` after committing to write `kodo/upstream-base.txt`.

## 2026-04-28

- Fork branch: `sync/upstream-2026-04-28`
- Fork base: `boggedbrush/KodoCode@f46ba8d06b6a8fe3f4add376bc7ed46137168292`
- Upstream range reviewed: `pingdotgg/t3code@5cf83ffe8f9d5eabd1c17721bd1f9597c97d98fe..main`
- Upstream release window: no newer release tag was available through the local git remote; GitHub compare reported one new upstream `main` commit after `v0.0.22-nightly.20260427.135`.
- Fork PR: https://github.com/boggedbrush/KodoCode/pull/15

### Classification

- upstream `main` +1 commit touching `apps/web/src/rpc/protocol.ts`, `apps/web/src/rpc/wsTransport.ts`, and `apps/web/src/rpc/wsTransport.test.ts` - `SKIP`: frontend RPC transport lifecycle hardening for upstream's newer `WsTransport` session/reconnect split. Kodo's active sync branch still routes the web RPC runtime through `WsRpcAtomClient` and `createWsRpcProtocolLayer()` directly, with no local `wsTransport.ts` equivalent to patch. Importing the upstream transport split would be broader than this bounded sync and would touch visible runtime/reconnect behavior.

### Applied Changes

- None.

### Adapted Changes

- None.

### Selective Frontend Changes Ported

- None.

### Manual-Review Candidates

- Carry forward the 2026-04-24 manual-review candidates: provider model-selection option arrays, dynamic tool-call request-permission schema, and Claude session cwd resume drift.

### Skipped Changes

- Upstream frontend RPC transport lifecycle hardening: not safely applicable without the upstream `WsTransport` architecture. Protected Kodo workflow, model selector `auto` behavior, and KodoCode identity were left untouched.

### Checks

- `bun fmt` not run: the only `bun.exe` on PATH is the WinGet link at `C:\Users\Admin\AppData\Local\Microsoft\WinGet\Links\bun.exe`, and this sandbox cannot execute it (`No application is associated with the specified file for this operation`).
- `bun lint` not run: same local Bun launcher failure.
- `bun typecheck` not run: same local Bun launcher failure.

### Browser Review

- Not required: no frontend-presentational changes were applied.

## 2026-04-27

- Fork branch: `sync/upstream-2026-04-25`
- Fork base: `boggedbrush/KodoCode@f46ba8d06b6a8fe3f4add376bc7ed46137168292`
- Upstream range reviewed: `pingdotgg/t3code@ada410bccff144ce4cfed0e2c6e18974b045f968..5cf83ffe8f9d5eabd1c17721bd1f9597c97d98fe`
- Upstream release window: `v0.0.22-nightly.20260427.135`
- Fork PR: https://github.com/boggedbrush/KodoCode/pull/14

### Classification

- `5cf83ffe` `fix(release): use configured node for smoke manifest merge (#2364)` - `SKIP`: release-smoke tooling fix for an upstream Windows updater-manifest merge block that is not present in Kodo's current `scripts/release-smoke.ts`. Cherry-pick conflicts because the fixed invocation has no local equivalent to patch, and importing the surrounding upstream release-smoke coverage would be broader than this bounded sync.

### Applied Changes

- None.

### Adapted Changes

- None.

### Selective Frontend Changes Ported

- None.

### Manual-Review Candidates

- Carry forward the 2026-04-24 manual-review candidates: provider model-selection option arrays, dynamic tool-call request-permission schema, and Claude session cwd resume drift.

### Skipped Changes

- `5cf83ffe` release-smoke configured-Node fix: not applicable without the upstream Windows updater-manifest merge block.

### Checks

- `bun fmt` passed.
- `bun lint` passed with two existing warnings in `apps/server/src/os-jank.ts` and `apps/server/src/persistence/Layers/ProjectionThreads.ts`.
- `bun typecheck` passed.

## 2026-04-25

- Fork branch: `sync/upstream-2026-04-25`
- Fork base: `boggedbrush/KodoCode@f46ba8d06b6a8fe3f4add376bc7ed46137168292`
- Upstream range reviewed: `pingdotgg/t3code@ada410bccff144ce4cfed0e2c6e18974b045f968..ada410bccff144ce4cfed0e2c6e18974b045f968`
- Upstream release window: no new upstream `main` commits after the 2026-04-24 reviewed endpoint.
- Fork PR: https://github.com/boggedbrush/KodoCode/pull/14

### Classification

- No new upstream commits to classify. The latest fetched upstream `main` remains at `ada410bccff144ce4cfed0e2c6e18974b045f968`, which was already reviewed in the 2026-04-24 sync entry.

### Applied changes

- None.

### Adapted changes

- None.

### Selective frontend changes ported

- None.

### Manual-review candidates

- Carry forward the 2026-04-24 manual-review candidates: provider model-selection option arrays, dynamic tool-call request-permission schema, and Claude session cwd resume drift.

### Skipped changes

- None newly skipped in this run.

### Checks

- `bun fmt` passed.
- `bun lint` passed with two existing warnings.
- `bun typecheck` passed.

## 2026-04-24

- Fork branch: `sync/upstream-2026-04-24`
- Fork base: `boggedbrush/KodoCode@40cd204092a3de25d5592de74cf99c689d8fa6d7`
- Upstream range reviewed: `pingdotgg/t3code@b0b7b38da1dc4b19833d13f84eb907b1e2adfb63..ada410bccff144ce4cfed0e2c6e18974b045f968`
- Upstream release window: `v0.0.21-nightly.20260423.101..v0.0.21/main@2026-04-23`
- Fork PR: https://github.com/boggedbrush/KodoCode/pull/13

### Classification

- `8d1d699f` `Refactor provider model selections to option arrays (#2246)` — `MANUAL REVIEW`: broad provider model-selection schema, settings, migration, server, shared, and web rewrite. It includes a new model-selection migration and visible composer/settings behavior, so it needs a dedicated adaptation pass rather than this bounded sync.
- `d5b7690f` `Exclude subscribe RPCs from latency tracking (#2313)` — `SKIP`: web/runtime latency-state behavior only; preserve Kodo-owned frontend behavior in this backend/runtime sync.
- `0ee302e2` `fix(request-permission): add dynamic_tool_call to command request (#2311)` — `MANUAL REVIEW`: protocol/contract request-permission shape change tied to runtime event semantics. It should be reviewed with the Codex app-server protocol surface before import.
- `0d55a428` `fix(web): ignore stale runtime projection snapshots (#2301)` — `SKIP`: frontend runtime projection handling; keep Kodo-specific session UX untouched in this pass.
- `188df6da` `Fix Claude session cwd resume drift (#2292)` — `MANUAL REVIEW`: valuable backend/runtime fix, but it touches Claude provider resume behavior and adapter tests. Defer for a focused provider-session adaptation with local validation.
- `00b5c3e1` `Add task sidebar auto-open setting (#2314)` — `SKIP`: user-visible settings/sidebar UX.
- `ada410bc` `chore(release): prepare v0.0.21` — `SKIP`: release/version churn only.

### Applied changes

- None. No reviewed upstream commit was safe to cherry-pick directly without importing broad provider schema churn or Kodo-owned frontend/settings behavior.

### Adapted changes

- None.

### Selective frontend changes ported

- None.

### Manual-review candidates

- `8d1d699f` Provider model selections to option arrays: dedicated schema/settings migration review required.
- `0ee302e2` Dynamic tool-call request-permission schema: protocol compatibility review required.
- `188df6da` Claude session cwd resume drift: focused provider-runtime adaptation and tests required.

### Skipped changes

- `d5b7690f` Subscribe RPC latency tracking: web runtime-state behavior.
- `0d55a428` Stale runtime projection snapshots: web runtime projection behavior.
- `00b5c3e1` Task sidebar auto-open setting: settings/sidebar UX.
- `ada410bc` Release prep: version churn.

### Checks

- `bun fmt` not run: this run only updated the sync log through the GitHub connector, and the local shell cannot fetch/write Git metadata due repository ACL restrictions.
- `bun lint` not run: same environment restriction.
- `bun typecheck` not run: same environment restriction.

## Prior Sync History

Detailed entries for 2026-04-17 through 2026-04-23 are preserved in the previous sync branch history and PR discussion at https://github.com/boggedbrush/KodoCode/pull/7. This run moved the active sync branch to `sync/upstream-2026-04-24` and recorded the current upstream review window here.
