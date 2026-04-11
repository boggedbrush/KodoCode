import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { Effect, Option } from "effect";

import type { CodexAccountSnapshot } from "../codexAccount";
import {
  probeCodexAccount,
  probeCodexUsage,
  type CodexUsageProbeSnapshot,
} from "../codexAppServer";
import { spawnAndCollect } from "../providerSnapshot";

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

export interface PtyApi {
  readonly runInteractive: (input: {
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly cwd?: string;
    readonly timeoutMs: number;
    readonly sendOnSubstring?: ReadonlyArray<{ readonly match: string; readonly send: string }>;
    readonly stopOnSubstring?: ReadonlyArray<string>;
  }) => Effect.Effect<
    {
      readonly stdout: string;
      readonly stderr: string;
      readonly exitCode: number;
    },
    Error
  >;
}

export interface SubprocessApi {
  readonly run: (input: {
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly cwd?: string;
    readonly timeoutMs: number;
    readonly env?: Record<string, string>;
  }) => Effect.Effect<
    {
      readonly stdout: string;
      readonly stderr: string;
      readonly exitCode: number;
    },
    Error
  >;
}

export interface StatusApi {
  readonly fetchStatuspage: (url: string) => Effect.Effect<
    {
      readonly indicator: "none" | "minor" | "major" | "critical";
      readonly description: string;
    },
    Error
  >;
}

export interface CodexAccountProbeApi {
  readonly probe: (input: {
    readonly binaryPath: string;
    readonly homePath?: string;
    readonly timeoutMs: number;
  }) => Effect.Effect<CodexAccountSnapshot, Error>;
}

export interface CodexUsageProbeApi {
  readonly probe: (input: {
    readonly binaryPath: string;
    readonly homePath?: string;
    readonly timeoutMs: number;
  }) => Effect.Effect<CodexUsageProbeSnapshot, Error>;
}

export const makeSubprocessApi = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const api: SubprocessApi = {
    run: (input) => {
      const command = ChildProcess.make(input.command, [...input.args], {
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.env ? { env: { ...process.env, ...input.env } } : {}),
        shell: process.platform === "win32",
      });

      return spawnAndCollect(input.command, command).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.timeoutOption(input.timeoutMs),
        Effect.flatMap((result) =>
          Option.match(result, {
            onNone: () =>
              Effect.fail(
                new Error(
                  `Command timed out after ${input.timeoutMs}ms: ${input.command} ${input.args.join(" ")}`,
                ),
              ),
            onSome: (value) => Effect.succeed(value),
          }),
        ),
        Effect.map((result) => ({
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.code,
        })),
        Effect.mapError(toError),
      );
    },
  };

  return api;
});

export const makeCodexAccountProbeApi = Effect.succeed<CodexAccountProbeApi>({
  probe: (input) =>
    Effect.tryPromise((signal) =>
      probeCodexAccount({
        binaryPath: input.binaryPath,
        ...(input.homePath ? { homePath: input.homePath } : {}),
        signal,
      }),
    ).pipe(
      Effect.timeoutOption(input.timeoutMs),
      Effect.flatMap((result) =>
        Option.match(result, {
          onNone: () =>
            Effect.fail(new Error(`Codex account probe timed out after ${input.timeoutMs}ms`)),
          onSome: (value) => Effect.succeed(value),
        }),
      ),
      Effect.mapError(toError),
    ),
});

export const makeCodexUsageProbeApi = Effect.succeed<CodexUsageProbeApi>({
  probe: (input) =>
    Effect.tryPromise((signal) =>
      probeCodexUsage({
        binaryPath: input.binaryPath,
        ...(input.homePath ? { homePath: input.homePath } : {}),
        signal,
      }),
    ).pipe(
      Effect.timeoutOption(input.timeoutMs),
      Effect.flatMap((result) =>
        Option.match(result, {
          onNone: () =>
            Effect.fail(new Error(`Codex usage probe timed out after ${input.timeoutMs}ms`)),
          onSome: (value) => Effect.succeed(value),
        }),
      ),
      Effect.mapError(toError),
    ),
});
