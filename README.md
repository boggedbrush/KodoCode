# Kodo Code

Kodo Code is a fork of [T3 Code](https://github.com/pingdotgg/t3code), a minimal GUI for coding agents. Kodo Code keeps T3 Code's foundation and adds its own design and a structured set of interaction modes for working with agents.

## Modes

Kodo Code's interaction modes keep exploring, planning, implementing, and reviewing separate:

- **Ask**: read-only Q&A about the codebase.
- **Plan**: produce a plan before changing anything.
- **Code**: implement changes.
- **Review**: read-only review of working changes.

Kodo Code is still early and under active re-development on top of the latest stable T3 Code release (currently `v0.1.9`). Some Kodo-only features are not yet re-ported; see [docs/upstream-sync-log.md](./docs/upstream-sync-log.md) for the current list.

## Development

Kodo Code uses [Vite+](https://viteplus.dev/guide/), so you'll need the global `vp` command-line tool.

### Install `vp`

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

### Run in development

```bash
vp run dev
```

This starts the server and the web app. Ports can shift when occupied; the `[dev-runner]` line in the output shows the real ones.

### Checks

```bash
vp run check:changed   # format, lint, knip, typecheck, and tests for changed files
vp run typecheck       # typecheck all packages
vp test run <files>    # run tests for specific files while iterating
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before reporting a bug or opening a PR. For the architecture, start at [docs/internals/overview.md](./docs/internals/overview.md). Agent and contributor guidance lives in [AGENTS.md](./AGENTS.md).

## Syncing with upstream

Kodo Code tracks T3 Code's stable releases (`vX.Y.Z` tags, never `main`) and merges each one after it ships. See [docs/kodo-upstream-sync.md](./docs/kodo-upstream-sync.md) for the policy and tooling. Each sync is recorded in [docs/upstream-sync-log.md](./docs/upstream-sync-log.md).

## Acknowledgement

Kodo Code builds on [T3 Code](https://github.com/pingdotgg/t3code), created by [Theo Browne](https://github.com/t3dotgg), [Julius Marminge](https://github.com/juliusmarminge), and the T3 Tools team. Their work made this project possible.

## License

Kodo Code is released under the MIT License, the same license as T3 Code. See [LICENSE](./LICENSE). Copyright (c) 2026 T3 Tools Inc.
