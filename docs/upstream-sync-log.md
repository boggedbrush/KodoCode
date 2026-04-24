# Upstream Sync Log

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
