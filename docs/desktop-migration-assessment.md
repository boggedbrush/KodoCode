# Desktop Migration Assessment

## Environment

- Workspace: `/mnt/c/Users/Admin/Documents/GitHub/KodoCode`
- Current shell/runtime during implementation: WSL2 Debian 12 on Windows 11 host
- Host desktop benchmark target: Windows 11 host
- Package manager: Bun (`packageManager: bun@1.3.9`)
- Current constraint: desktop benchmarking should run on the Windows host, not inside WSL, to avoid distorted startup, memory, windowing, and process metrics.

## Current Architecture

### App entrypoints

- Desktop shell main: [apps/desktop/src/main.ts](/mnt/c/Users/Admin/Documents/GitHub/KodoCode/apps/desktop/src/main.ts)
- Desktop preload: [apps/desktop/src/preload.ts](/mnt/c/Users/Admin/Documents/GitHub/KodoCode/apps/desktop/src/preload.ts)
- Web renderer entry: [apps/web/src/main.tsx](/mnt/c/Users/Admin/Documents/GitHub/KodoCode/apps/web/src/main.tsx)
- Server CLI/runtime entry: [apps/server/src/bin.ts](/mnt/c/Users/Admin/Documents/GitHub/KodoCode/apps/server/src/bin.ts)

### Renderer/frontend structure

- React 19 + Vite web app
- TanStack Router for route structure
- TanStack React Query for cached async state
- Zustand for client state
- Effect RPC/WebSocket integration for server communication
- xterm for terminal rendering
- Virtualized diff rendering via `@pierre/diffs/react`

### Desktop shell assumptions

- Single primary desktop window
- Custom titlebar/window chrome on Linux and hidden inset titlebar on macOS
- Renderer bootstraps against a desktop-provided WebSocket URL
- Desktop shell owns application menu, native context menus, dialogs, updater state, and external-link handling
- Desktop shell spawns and supervises the backend process

### Native APIs currently used

- Window controls: minimize, maximize/unmaximize, close, maximized-state subscription
- Folder picker dialog
- Confirmation dialog
- External URL opening
- Application menu dispatch
- Native context menu popup
- Theme synchronization from renderer to desktop shell
- Auto-update state/check/download/install actions

### Environment/config loading

- Bun workspace monorepo
- Root desktop dev path currently routes `bun dev:desktop` to the Electron target
- Desktop shell derives app data roots from `KODOCODE_HOME` / `T3CODE_HOME`
- Server bootstrap is written over fd 3 to the child process with port, auth token, base dir, and observability settings

### Build pipeline

- Root workspace orchestrated by Turbo
- Web build via Vite
- Desktop build via `tsdown`
- Server build via Bun + tsdown wrapper script
- Current packaged desktop artifacts are assembled with a custom `electron-builder` staging script

### Packaging/distribution assumptions

- Electron is the current packaged desktop baseline
- Release artifacts currently target macOS DMG, Linux AppImage, Windows NSIS
- Existing release docs and scripts assume Electron packaging and Electron updater metadata

### Auto-update assumptions

- Renderer exposes update UI today
- Shell uses `electron-updater`
- Update checks run after startup delay and on poll interval
- Download and install are user-triggered
- Update parity is required for Electron baseline but deferred for Electrobun v1

### Local persistence/storage assumptions

- Browser storage for renderer-local preferences and UI state
- Server-owned persistence under app data:
  - SQLite state DB
  - auth DB
  - settings JSON
  - keybindings JSON
  - attachments
  - logs and traces
  - worktrees
  - secrets

### Background workers / child process use

- Desktop shell spawns backend server child process
- Backend uses PTY integration and provider child processes
- Backend already contains some runtime selection for Bun vs Node services

### Performance-sensitive screens and flows

- Launch to first visible window
- Launch to usable app state after backend connection
- Sidebar thread/project navigation
- Chat timeline rendering
- Diff panel rendering
- Terminal open/use/resizing
- Settings/about/update surfaces

## Portability Classification

### Direct carryover

- `apps/web` renderer application
- Most of `apps/server`
- WebSocket/RPC protocol
- Thread/chat UI logic
- Terminal and diff UI logic
- Settings and orchestration flows

### Adapter needed

- Desktop bridge bootstrap
- Window lifecycle and control events
- Native dialogs
- External-link handling
- Application menu dispatch
- Native context menus
- Persistence/bootstrap path exposure
- Benchmark/test driver plumbing

### Missing or degraded in Electrobun v1

- Full updater parity is intentionally deferred
- Linux application menu parity is limited by current Electrobun docs
- Any Electron-specific release/update behavior should be treated as unsupported until verified

### Risky / prototype-first

- Backend child-process lifecycle under Electrobun on Windows
- Packaged path resolution and static asset loading
- Window maximize/unmaximize parity
- Native menu/context-menu parity
- Release artifact equivalence

### Initial stub policy

- Unsupported Electrobun functionality must be surfaced explicitly through capabilities
- Update UI must stay honest when update actions are unavailable
- No benchmark or correctness claim should be made for flows not actually verified

## Recommended Migration Shape

1. Introduce a runtime-neutral desktop bridge contract in `packages/contracts`
2. Add shared desktop-runtime helpers in `packages/shared`
3. Move frontend code to a single adapter module instead of direct `window.desktopBridge` reads
4. Refactor Electron to implement the new contract without changing its role as the default desktop path
5. Add an experimental `apps/electrobun` shell that reuses the same renderer/server outputs
6. Add benchmark state/milestone plumbing that both runtimes can emit consistently
7. Build correctness and benchmark runners against the shared driver

## Assumptions To Verify During Implementation

- Electrobun can supervise the backend process with the required stdio/bootstrap behavior on Windows
- Electrobun window lifecycle events are sufficient to reproduce current window-control behavior
- Electrobun typed RPC can carry the desktop bridge cleanly without forking renderer logic
- Production builds for both targets can consume the same renderer and server bundles without behavior drift
