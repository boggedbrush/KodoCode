![Kodo Code banner](./assets/prod/banner-logo.svg)

# Kodo Code

**Code with intention.**

![Kodo Code logo](./assets/prod/logo.svg) ![Phase 1](https://img.shields.io/badge/phase-1%20implemented-green) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## What is Kōdō?

**Kōdō (香道)** — _the Way of Incense_ — is the Japanese art of appreciating fragrance through ritual, presence, and deliberate attention. Every movement is intentional. Every choice has purpose.

**Kodo Code** brings that same spirit to software development: **a coding environment where every action is deliberate, every plan is considered, and execution follows from clear intent.**

---

## What it is

**Kodo Code** is a focused fork of the original project that orchestrates **[Codex CLI](https://developers.openai.com/codex/cli/)** and **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** inside a **Plan / Act workflow** with:

- 🔄 **Automatic model switching** between planning and acting
- 🔍 **Semantic codebase indexing** for large repositories
- ⚙️ **Rich settings management** for model policy and behavior
- 🖥️ **Desktop app now**, VS Code extension coming soon

### In short

> Most tools force you to choose: _good harness_ or _good workflow_.  
> Kodo Code gives you **both** — Codex and Claude execute; Kodo orchestrates.

---

## Why Kodo Code?

| Problem                              | Solution                                   |
| ------------------------------------ | ------------------------------------------ |
| Same model plans _and_ acts          | Separate models per mode                   |
| Blind full-repo scans waste context  | Semantic indexing finds what matters       |
| Settings buried in implementation    | First-class config surface                 |
| Harness locked to one provider       | Codex CLI **or** Claude Code — your choice |
| No bridge between desktop and editor | Shared workflow, shared config             |

---

## How it compares

|                               | **Kodo Code**                       | Original project         | [Cline](https://github.com/cline/cline) | [Roo Code](https://github.com/RooVetGit/Roo-Code) | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | [Codex CLI](https://developers.openai.com/codex/cli/) |
| ----------------------------- | ----------------------------------- | ------------------------ | --------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| **Harness**                   | Codex CLI · Claude Code             | Custom (extensible)      | Custom (API-based)                      | Custom (API-based)                                | Native Claude                                                 | Native OpenAI                                         |
| **Plan / Act workflow**       | ✅ Core feature                     | ✅ Built-in              | ❌ Single mode                          | ✅ Modes available                                | ❌ Terminal-only                                              | ❌ Terminal-only                                      |
| **Auto model switch by mode** | ✅ Yes                              | ⚠️ Manual                | ❌ N/A                                  | ✅ Per-task                                       | ❌ N/A                                                        | ❌ N/A                                                |
| **Semantic indexing**         | ✅ Planned (Phase 2)                | ❌                       | ❌                                      | ✅ Built-in                                       | ❌                                                            | ❌                                                    |
| **Dual-harness support**      | ✅ Codex + Claude                   | ❌ Original project only | ❌ API only                             | ❌ API only                                       | —                                                             | —                                                     |
| **Desktop UI**                | ✅ Forked from the original project | ✅ Original              | ✅ VS Code panel                        | ✅ VS Code panel                                  | ❌ Terminal only                                              | ❌ Terminal only                                      |
| **VS Code extension**         | 🔄 Phase 3                          | ❌ Not planned           | ✅ Primary surface                      | ✅ Primary surface                                | ❌                                                            | ❌                                                    |
| **Commit message model**      | ✅ Separate policy                  | ⚠️ Basic support         | ❌                                      | ❌                                                | ❌                                                            | ❌                                                    |
| **Settings surface**          | ✅ Expanded, first-class            | ✅ Baseline              | ✅ Config file                          | ✅ Config file                                    | ⚠️ Flags/env                                                  | ⚠️ Flags/env                                          |
| **Philosophy**                | Orchestrator, not reinventer        | Full product stack       | Editor-first agent                      | Feature-rich agent                                | Raw terminal harness                                          | Raw terminal harness                                  |

### TL;DR

- **vs. the original project:** Same base + dual harnesses + auto model switching + indexing roadmap
- **vs. Cline/Roo Code:** Harness-grade execution (Codex/Claude) instead of raw API calls + Plan/Act as first-class concept
- **vs. Claude Code / Codex CLI alone:** Adds workflow layer, UI, model orchestration, and retrieval on top
- **Not competing with any of them directly** — Kodo Code sits _between_ the harnesses and you

---

## Core features

<details open>
<summary><b>📋 Plan Mode</b> — think before you build</summary>

- Repo analysis & strategy
- Task breakdown & risk review
- Optional retrieval from codebase index
- **Dedicated planning model + reasoning level**
</details>

<details>
<summary><b>⚡ Act Mode</b> — build with precision</summary>

- File edits, commands, tests, debugging
- Auto-switches to dedicated acting model
- Rich diffs, terminal output, execution visibility
- Context carried forward from approved plan
</details>

<details>
<summary><b>🔀 Dual Harness Support</b></summary>

- **[Codex CLI](https://developers.openai.com/codex/cli/)** — OpenAI's agent harness
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** — Anthropic's terminal agent
- Switch per-project or per-session
- Same workflow semantics regardless of harness
</details>

<details>
<summary><b>🧠 Semantic Indexing</b></summary>

- OpenAI-compatible embeddings (local or hosted)
- [Ollama](https://docs.ollama.com/capabilities/embeddings) for local generation
- [Qdrant](https://qdrant.tech/documentation/) as vector store
- Reduces context waste, improves targeting
</details>

---

## Architecture

```
┌─────────────────────────────┐
│   Original-project-derived Desktop UI  │  ← Plan / Act surface
└──────────────┬──────────────┘
               │
       ┌───────▼───────┐
       │  Kodo Orchestrator  │  ← Model switching · Retrieval · Settings
       └───────┬───────┘
               │
    ┌──────────▼──────────┐
    │ Codex CLI / Claude Code │  ← Execution only
    └──────────┬──────────┘
               │
        Repo · Terminal · Files
```

> **Rule:** _Harnesses execute. Kodo orchestrates._

## Desktop targets

- `bun dev:desktop`: Electron desktop app. This remains the default desktop path.
- `bun dev:electrobun`: Experimental Electrobun shell. Treat this as testing-only until the benchmark report says otherwise. It currently runs against the built web/server assets rather than the Vite dev server.
- `bun build:desktop`: Builds the Electron desktop baseline plus the shared server assets it depends on.
- `bun build:electrobun`: Builds the experimental Electrobun target plus the shared web/server assets it depends on.
- `bun run test:desktop:correctness`: Runs the shared desktop correctness flow for both targets.
- `bun run benchmark:desktop`: Runs the desktop benchmark harness and writes raw artifacts under `artifacts/desktop-benchmarks/`.
- `bun run report:desktop`: Regenerates `docs/desktop-benchmark-report.md` from the latest benchmark results.

### Notes

- Electron stays the baseline and primary supported desktop workflow.
- Electrobun currently disables updater support explicitly instead of pretending parity.
- The benchmark and correctness scripts are intended to run on the Windows host, not inside WSL.

---

## Configuration example

```jsonc
{
  "plan": {
    "model": "gpt-5.3-codex",
    "reasoning": "high",
  },
  "act": {
    "model": "gpt-5.1-codex-max",
    "reasoning": "medium",
  },
  "commitMessages": {
    "model": "gpt-5.4-mini",
    "style": "conventional",
  },
  "indexing": {
    "enabled": true,
    "provider": "ollama",
    "model": "nomic-embed-text",
    "qdrantUrl": "http://localhost:6333",
    "autoIndexOnOpen": true,
  },
}
```

---

## Roadmap

| Phase | Status         | What                                                               |
| ----- | -------------- | ------------------------------------------------------------------ |
| **1** | ✅ Implemented | Fork original project, Plan/Act model switching, expanded settings |
| **2** | 🔄 Next        | Semantic codebase indexing, Qdrant + Ollama integration            |
| **3** | 🔮 Planned     | VS Code extension with shared workflow semantics                   |

See [`docs/ARCHITECTURE-PHASE1.md`](docs/ARCHITECTURE-PHASE1.md) for Phase 1 details.

---

## Who it's for

You'll like Kodo Code if you:

- Love tools like [Cline](https://github.com/cline/cline) but want a stronger harness underneath
- Want different models for _thinking_ vs. _doing_
- Care about token efficiency and cost-per-task
- Work in repos large enough that blind scanning hurts
- Want a desktop experience today and editor integration tomorrow

---

## What it isn't

- ❌ A new harness (Codex and Claude already exist)
- ❌ A reimplementation of runtime behavior
- ❌ A generic chat app with coding bolted on
- ❌ A terminal emulator pretending to be an IDE

---

## Project status

**Phase 1 complete.** Kodo Code is a working fork with automatic Plan/Act model switching and full settings management.

Remaining work:

1. ~~Model switching~~ ✅
2. Codebase indexing _(Phase 2)_
3. VS Code extension _(Phase 3)_
4. ~~Settings expansion~~ ✅

---

## Vision

> **Keep the best harnesses. Keep the best workflow base. Build only the missing layer.**

Kodo Code exists so you can code the way kōdō practitioners approach incense: **with presence, with purpose, with intention.**
