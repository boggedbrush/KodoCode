import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { readCodexAccountSnapshot, type CodexAccountSnapshot } from "./codexAccount";

interface JsonRpcProbeResponse {
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: {
    readonly message?: unknown;
  };
}

function readErrorMessage(response: JsonRpcProbeResponse): string | undefined {
  return typeof response.error?.message === "string" ? response.error.message : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function extractJsonObjectText(input: string): string | null {
  const start = input.indexOf("{");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < input.length; index += 1) {
    const char = input[index]!;

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return input.slice(start, index + 1);
      }
    }
  }

  return null;
}

function parseRateLimitsFromErrorMessage(errorMessage: string): unknown | null {
  const bodyIndex = errorMessage.indexOf("body=");
  if (bodyIndex < 0) {
    return null;
  }

  const parsedBodyText = extractJsonObjectText(errorMessage.slice(bodyIndex + 5));
  if (!parsedBodyText) {
    return null;
  }

  try {
    return JSON.parse(parsedBodyText);
  } catch {
    return null;
  }
}

export interface CodexUsageProbeSnapshot {
  readonly account: CodexAccountSnapshot;
  readonly email: string | null;
  readonly rateLimits: unknown | null;
}

export function buildCodexInitializeParams() {
  return {
    clientInfo: {
      name: "kodo_code_desktop",
      title: "Kodo Code Desktop",
      version: "0.1.0",
    },
    capabilities: {
      experimentalApi: true,
    },
  } as const;
}

export function killCodexChildProcess(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    try {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch {
      // Fall through to direct kill when taskkill is unavailable.
    }
  }

  child.kill();
}

export async function probeCodexUsage(input: {
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly signal?: AbortSignal;
}): Promise<CodexUsageProbeSnapshot> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.binaryPath, ["app-server"], {
      env: {
        ...process.env,
        ...(input.homePath ? { CODEX_HOME: input.homePath } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    const output = readline.createInterface({ input: child.stdout });

    let completed = false;

    const cleanup = () => {
      output.removeAllListeners();
      output.close();
      child.removeAllListeners();
      if (!child.killed) {
        killCodexChildProcess(child);
      }
    };

    const finish = (callback: () => void) => {
      if (completed) return;
      completed = true;
      cleanup();
      callback();
    };

    const fail = (error: unknown) =>
      finish(() =>
        reject(
          error instanceof Error
            ? error
            : new Error(`Codex account probe failed: ${String(error)}.`),
        ),
      );

    if (input.signal?.aborted) {
      fail(new Error("Codex account probe aborted."));
      return;
    }
    input.signal?.addEventListener("abort", () => fail(new Error("Codex account probe aborted.")));

    const writeMessage = (message: unknown) => {
      if (!child.stdin.writable) {
        fail(new Error("Cannot write to codex app-server stdin."));
        return;
      }

      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    let accountReadResult: unknown;
    let accountReadSettled = false;
    let modelListResult: unknown;
    let modelListSettled = false;
    let rateLimitsResult: unknown = null;
    let rateLimitsSettled = false;

    const maybeFinish = () => {
      if (!accountReadSettled || !modelListSettled || !rateLimitsSettled) {
        return;
      }

      finish(() => {
        const accountReadRecord = asRecord(accountReadResult);
        const accountRecord = asRecord(accountReadRecord?.account) ?? accountReadRecord;
        resolve({
          account: readCodexAccountSnapshot(accountReadResult, modelListResult),
          email: asString(accountRecord?.email) ?? null,
          rateLimits: rateLimitsResult,
        });
      });
    };

    output.on("line", (line) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        fail(new Error("Received invalid JSON from codex app-server during account probe."));
        return;
      }

      if (!parsed || typeof parsed !== "object") {
        return;
      }

      const response = parsed as JsonRpcProbeResponse;
      if (response.id === 1) {
        const errorMessage = readErrorMessage(response);
        if (errorMessage) {
          fail(new Error(`initialize failed: ${errorMessage}`));
          return;
        }

        writeMessage({ method: "initialized" });
        writeMessage({ id: 2, method: "account/read", params: {} });
        writeMessage({ id: 3, method: "model/list", params: {} });
        writeMessage({ id: 4, method: "account/rateLimits/read", params: {} });
        return;
      }

      if (response.id === 2) {
        const errorMessage = readErrorMessage(response);
        if (errorMessage) {
          fail(new Error(`account/read failed: ${errorMessage}`));
          return;
        }

        accountReadResult = response.result;
        accountReadSettled = true;
        maybeFinish();
        return;
      }

      if (response.id === 3) {
        if (!readErrorMessage(response)) {
          modelListResult = response.result;
        }
        modelListSettled = true;
        maybeFinish();
        return;
      }

      if (response.id === 4) {
        const errorMessage = readErrorMessage(response);
        if (errorMessage) {
          rateLimitsResult = parseRateLimitsFromErrorMessage(errorMessage);
        } else {
          rateLimitsResult = response.result ?? null;
        }
        rateLimitsSettled = true;
        maybeFinish();
      }
    });

    child.once("error", fail);
    child.once("exit", (code, signal) => {
      if (completed) return;
      fail(
        new Error(
          `codex app-server exited before probe completed (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
        ),
      );
    });

    writeMessage({
      id: 1,
      method: "initialize",
      params: buildCodexInitializeParams(),
    });
  });
}

export async function probeCodexAccount(input: {
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly signal?: AbortSignal;
}): Promise<CodexAccountSnapshot> {
  const probe = await probeCodexUsage(input);
  return probe.account;
}
