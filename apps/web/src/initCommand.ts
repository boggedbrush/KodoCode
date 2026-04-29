import type { ProviderKind, ServerProvider } from "@t3tools/contracts";

export type HarnessGuideFile = "AGENTS.md" | "CLAUDE.md";

export const INIT_COMMAND_TEMPLATE = `# Repository Guidelines

Replace these placeholder notes with concise, repository-specific instructions. Keep the final document direct and actionable, ideally 200-400 words.

## Project Structure & Module Organization
- Outline the project structure, including where source code, tests, and assets are located.
- Call out important entrypoints, generated files, and directories to avoid editing.

## Build, Test, and Development Commands
- List key commands for building, testing, and running locally.
- Briefly explain what each command does and note commands that require extra setup.

## Coding Style & Naming Conventions
- Specify indentation rules, language-specific style preferences, and naming patterns.
- Include any formatting or linting tools used.

## Testing Guidelines
- Explain the primary test runners, smoke checks, and required verification before merge.
- Include test naming conventions and when to run each suite.

## Commit & Pull Request Guidelines
- Capture commit message format, review expectations, and any PR checklist items.
- Note when screenshots, logs, or deployment notes should be included.

## Optional: Security, Configuration, or Architecture Notes
- Add sections only when relevant, such as security tips, configuration requirements, architecture overview, or agent-specific instructions.
`;

export function buildInitCommandPrompt(file: HarnessGuideFile): string {
  return `Generate a file named ${file} that serves as a contributor guide for this repository.
Your goal is to produce a clear, concise, and well-structured document with descriptive headings and actionable explanations for each section.
Follow the outline below, but adapt as needed: add sections if relevant, and omit those that do not apply to this project.

Document Requirements

- Title the document "Repository Guidelines".
- Use Markdown headings (#, ##, etc.) for structure.
- Keep the document concise. 200-400 words is optimal.
- Keep explanations short, direct, and specific to this repository.
- Provide examples where helpful (commands, directory paths, naming patterns).
- Maintain a professional, instructional tone.
- Edit ${file} in place. Do not create a different guide file.

Recommended Sections

Project Structure & Module Organization

- Outline the project structure, including where the source code, tests, and assets are located.

Build, Test, and Development Commands

- List key commands for building, testing, and running locally (e.g., npm test, make build).
- Briefly explain what each command does.

Coding Style & Naming Conventions

- Specify indentation rules, language-specific style preferences, and naming patterns.
- Include any formatting or linting tools used.

Testing Guidelines

Commit & Pull Request Guidelines

(Optional) Add other sections if relevant, such as Security & Configuration Tips, Architecture Overview, or Agent-Specific Instructions.`;
}

export function getGuideFileForProvider(provider: ProviderKind): HarnessGuideFile {
  return provider === "claudeAgent" ? "CLAUDE.md" : "AGENTS.md";
}

export function getCompanionGuideFile(file: HarnessGuideFile): HarnessGuideFile {
  return file === "AGENTS.md" ? "CLAUDE.md" : "AGENTS.md";
}

export function countAvailableHarnesses(providers: ReadonlyArray<ServerProvider>): number {
  return providers.filter((provider) => provider.enabled && provider.installed).length;
}

export function isClaudeHarnessEnabled(providers: ReadonlyArray<ServerProvider>): boolean {
  return providers.some(
    (provider) => provider.provider === "claudeAgent" && provider.enabled && provider.installed,
  );
}
