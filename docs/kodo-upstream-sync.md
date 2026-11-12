# Kodo upstream sync

Kodo is upstream T3 Code plus a small overlay. The overlay is described in `kodo/overlay.manifest.ts`; `scripts/kodo` merges upstream and puts it back.

## Release policy

Kodo tracks upstream's **stable releases**, not `main`. A Kodo update ships only after T3 Code publishes a stable `vX.Y.Z`; Kodo's own features can ship in between on the same upstream base.

- Sync to stable release tags only (plain `vX.Y.Z`; previews `-preview.*` and nightlies `-nightly.*` do not count). **Never merge `upstream/main`.**
- `pnpm kodo:sync` with no `--ref` fetches tags and targets the newest stable tag (highest semver, so `v0.1.10` beats `v0.1.9`). If HEAD already contains it, it says "Already on the latest stable release" and does nothing.
- `--ref` accepts anything, but a branch, preview or nightly tag, or a raw commit is refused unless you pass `--allow-unreleased`. Dry-run always reports.
- Hotfix cherry-picks from upstream are allowed between releases, but each one must be recorded in `docs/upstream-sync-log.md` (commit, why it cannot wait). They are not a reason to merge `main`.
- `kodo/upstream-base.txt` records the release the fork is on (tag, commit, date synced). `sync` writes it; `pnpm kodo:status --record` writes it from history once the base is a stable tag with no unreleased upstream commits in it.
- `pnpm kodo:status` (read-only) answers "is there anything to update to?": the current base release, the newest stable release, the commits and Kodo touchpoints (hooks, replacements, assets, lockfile) between them, and prereleases beyond it.
- `pnpm kodo:check` warns when history holds upstream commits beyond the newest stable release it contains (an unreleased base). It is a warning, not a failure. `pnpm kodo:check --release` turns it into a failure; use that as the gate before shipping a Kodo release.

## Happy path

```sh
pnpm kodo:status           # is there a newer stable release? what would it touch?
pnpm kodo:sync --dry-run   # optional: size the sync first, changes nothing
pnpm kodo:sync             # merge the newest stable tag, re-apply, check, verify, log
```

Then read the new entry at the top of `docs/upstream-sync-log.md`, run `vp i` if it says dependencies changed, and open a PR from the `sync/upstream-vX.Y.Z` branch. The script never pushes.

`sync` refuses a dirty tree. It fetches `upstream` and its tags, creates `sync/upstream-<release>` from the current branch and merges the release tag (`--ref vX.Y.Z` to pick another stable tag; `--no-fetch` to work offline). On a clean merge it adds three commits: the merge, `kodo: re-apply overlay after upstream sync` (only if `apply` changed anything), and the log entry. It then runs `check` and the manifest's verification commands. Failures are recorded in the log and the exit code is 1, but the branch is still committed so you can fix it forward.

## Conflict policy

| Path                                                              | Resolution                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------- |
| Under `kodoOwned`                                                 | Ours; the log warns that upstream ships a file there |
| A manifest `lockfiles` entry                                      | Upstream's; reinstall afterwards                     |
| An `assets` destination that still exists on both sides           | Upstream's, then `apply` rewrites it from `kodo/`    |
| Anything else (hooked files, replacement targets, `package.json`) | Left in place for you                                |

## When it stops on conflicts

The output lists each file with why it conflicts and which manifest entries touch it (hooks to keep, replacements to re-run). Nothing is committed.

1. Resolve the files. Keep every `KODO: <hook>` line listed; for a replacement target, take upstream's text and let `apply` redo the wording.
2. `git add` them.
3. `pnpm kodo:sync --continue`. It refuses while paths are unmerged, tracked files are unstaged, or conflict markers remain, then does the rest and logs the files you resolved by hand.

To give up: `git merge --abort && git switch <your branch> && git branch -D sync/upstream-<release>`.

## Reading the reports

`apply` and `check` print every entry with a status:

- `applied` / `pending` (check): written, or would be written. `check` fails on `pending`.
- `already-applied`: nothing to do.
- `target-missing`: upstream moved, renamed or rewrote what the entry points at. The message names the entry and what to update in the manifest. Nothing is written for that entry.
- `mismatch`: the target exists but `expect` no longer holds, or the JSON does not parse.
- `source-missing`: the Kodo source file of an asset copy is gone.
- `placeholder`: an entry with a `todo` field; validated and listed, never enforced.

`apply` also lists missing hooks (it cannot restore them) and exits 1 for them. `check` also fails when a `KODO: <hook>` is missing (or its file is gone) and when a leak check finds a forbidden upstream string. It is read-only and suitable for CI: `pnpm kodo:check`.

## Adding to the manifest

Whenever Kodo work edits something in an upstream file, add the matching entry in the same change:

- A new Kodo-only file or directory: add it to `kodoOwned`.
- A replaced upstream asset: put the source under `kodo/assets/` and add an `assets` entry.
- A visible string reworded: a `replacements` entry (`find` must not appear in `replace`; use `expect: "at-least-one"` unless the count is meaningful). Add a `leakChecks` glob if the area is user-visible.
- A value in package or builder config: a `jsonEdits` entry with the key path.
- Any other edit inside an upstream file: mark it `// KODO: <hook-name>` (kebab-case, stable) and list the name under `hooks` for that file. Brand edits may use a short comment instead (`// KODO: Kodo app id`); list its start. `pnpm kodo:check` warns about files that carry a marker the manifest does not list.
- A Kodo-owned file that replaces an upstream one wholesale (README.md): `kodoOwned` with `upstreamHasIt: true`, so ours wins on conflict without a warning on every sync.
- A test that proves the work: add it to `verify.testFiles`.

Replace a `todo` placeholder instead of adding beside it, then run `pnpm kodo:apply` twice (the second run must change nothing) and `pnpm kodo:check`. Both commands exit non-zero on a malformed manifest and say which field is wrong.

## Brand codemod

Desktop messages say `${APP_BASE_NAME}` where upstream says "T3 Code". `brandCodemod` in the manifest redoes that edit mechanically: it parses each in-scope file with TypeScript, rewrites the brand inside string and template literals to `${APP_BASE_NAME}` and adds the import. It skips comments, regexes, imports, object keys and types, and it reports (does not rewrite) a literal used in a comparison, a `switch` case, `includes()`/`RegExp()`, `Schema.Literal()`, `as const` or a tagged template. A `keep` entry exempts one literal (`text`) or a whole file.

- `apply` (and so every sync) runs it, so new upstream messages are converted without a human. `check` fails while a rewritable literal remains or an unsafe one is unaccounted for.
- On a merge conflict, a file whose only difference from upstream is the codemod (compared token by token, so formatting does not matter) takes upstream's version and is rewritten again. A file with a `KODO:` hook or any other edit is left to a human.
- `pnpm kodo:codemod-audit [--ref <ref>]` is read-only. It runs the codemod on `<ref>`'s files and compares them with the working tree: `match` means codemod-owned, `differs` lists the hunks that are not branding (hand edits, which stay hook-owned), `unsafe` needs a keep entry or a hand edit.
- Run `vp fmt` on the files `apply` changed; the codemod does not reflow lines.

## Known follow-ups outside the overlay

These are not covered by `kodo:apply`/`kodo:check`; each needs a deliberate change.

- `.github/workflows/release-desktop.yml` (around line 729) smoke-checks `squashfs-root/t3code`. With the Kodo executable name (`APP_PACKAGE_NAME`, `kodo-code`) that check fails. Workflows are not edited by the overlay.
- Release and nightly workflows are gated on `pingdotgg/t3code` and need the fork's own release secrets before they run on `boggedbrush/KodoCode`.
- The nightly and macOS Icon Composer icon sources still carry the upstream mark, and `pnpm icons:export` would regenerate upstream icons over the `kodo/assets` copies. Do not run it until those sources are replaced.
- `apps/desktop/resources/linux/app.kodocode.metainfo.xml` is a rename of upstream's `com.t3tools.t3code.metainfo.xml` at about 51% similarity, near git's rename threshold. If upstream edits the old file, expect a modify/delete conflict for a human.
- Telemetry is off until an operator supplies `KODO_POSTHOG_KEY` and `KODO_POSTHOG_HOST` at build time (or the `T3CODE_POSTHOG_*` variables at run time). The `identity-analytics` leak check fails if upstream's key or host return.

## What it does not do

- Push, force-push, open PRs, or delete branches (other than rolling back its own failed merge start).
- Run `vp i`. Reinstall yourself when the log says the lockfile or a `package.json` changed.
- Resolve conflicts it cannot call unambiguously, or judge whether a hook still means the right thing after upstream refactors around it.
- Rewrite regex or structural code changes: replacements are literal, JSON edits are by key path. Anything bigger is a hook.
- Update `docs/upstream-sync-log.md` beyond appending its own entry. Hand-written classification notes still belong there.

Verification commands run with the repo's own `node_modules/.bin` first on `PATH`, so a sync uses the pinned `vp`, not a global one. `sync` prints only entries that need attention; `apply` and `check` print every entry.

Brand strings in web, shared and client-runtime are rewritten at build time by `apps/web/vite/brandText.ts`, so the manifest has no source replacements for them. The leak checks cover what that plugin does not: desktop source, the web shell and manifest, and build identity. Allowlist entries whose `why` starts with `KNOWN LEAK` are real leaks nobody has fixed yet; delete the entry when you fix the string.
