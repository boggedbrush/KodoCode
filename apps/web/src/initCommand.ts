import type { ProviderKind, ServerProvider } from "@t3tools/contracts";

export type HarnessGuideFile = "AGENTS.md" | "CLAUDE.md";

export const INIT_COMMAND_TEMPLATE = `# Repository Guidelines

Replace the placeholder notes below with instructions that are specific to this repository.

## Project Structure & Module Organization
- Describe where the app, packages, tests, and assets live.
- Call out important entrypoints, generated files, and directories to avoid editing directly.

## Build, Test, and Development Commands
- List the main install, dev, build, lint, format, and typecheck commands.
- Note any commands that must not be run automatically or that require extra setup.

## Coding Style & Naming Conventions
- Document formatter and linter expectations, naming patterns, and architecture boundaries.
- Mention language-specific preferences that should stay consistent across the repo.

## Testing Guidelines
- Explain the primary test runners, smoke checks, and required verification before merge.
- Include test naming conventions and when to run each suite.

## Commit & Pull Request Guidelines
- Capture commit message format, review expectations, and any PR checklist items.
- Note when screenshots, logs, or deployment notes should be included.

## Operational Notes
- Record environment setup, secrets handling, sandbox caveats, and agent-specific guardrails.
- Add any repository-specific constraints that should be followed during implementation.
`;

export function getGuideFileForProvider(provider: ProviderKind): HarnessGuideFile {
  return provider === "claudeAgent" ? "CLAUDE.md" : "AGENTS.md";
}

export function getCompanionGuideFile(file: HarnessGuideFile): HarnessGuideFile {
  return file === "AGENTS.md" ? "CLAUDE.md" : "AGENTS.md";
}

export function countAvailableHarnesses(providers: ReadonlyArray<ServerProvider>): number {
  return providers.filter((provider) => provider.enabled && provider.installed).length;
}
