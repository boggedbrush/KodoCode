import { DEFAULT_TERMINAL_ID, type NativeApi, type ServerConfig } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { readDesktopBridge } from "./desktopRuntime";
import { ensureNativeApi } from "./nativeApi";
import { useServerConfig } from "./rpc/serverState";

const INTERACTION_TERMINAL_THREAD_ID = "desktop-benchmark-terminal";
const BENCHMARK_TERMINAL_SENTINEL = "KODOCODE_DESKTOP_BENCHMARK";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return String(error);
}

async function navigateHash(hash: string): Promise<void> {
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
  await delay(200);
}

async function waitForTerminalOutput(
  api: NativeApi,
  threadId: string,
  terminalId: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for terminal output."));
    }, 10_000);
    const unsubscribe = api.terminal.onEvent((event) => {
      if (event.threadId !== threadId || event.terminalId !== terminalId) {
        return;
      }

      if (event.type === "output" && event.data.includes(BENCHMARK_TERMINAL_SENTINEL)) {
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      }
    });
  });
}

async function runInteractionScenario(api: NativeApi, serverConfig: ServerConfig): Promise<void> {
  const bridge = readDesktopBridge();
  if (!bridge) {
    throw new Error("Desktop bridge not available.");
  }

  await bridge.benchmark.markEvent("scenario.interaction.start");
  await navigateHash("#/settings/about");
  await bridge.benchmark.markEvent("scenario.navigate.settings.about");
  await navigateHash("#/settings/general");
  await bridge.benchmark.markEvent("scenario.navigate.settings.general");
  await navigateHash("#/");
  await bridge.benchmark.markEvent("scenario.navigate.home");

  const nextStreamingSetting = true;
  await api.server.updateSettings({
    enableAssistantStreaming: nextStreamingSetting,
  });
  const refreshedConfig = await api.server.getConfig();
  if (refreshedConfig.settings.enableAssistantStreaming !== nextStreamingSetting) {
    throw new Error("Settings persistence update did not round-trip.");
  }
  await bridge.benchmark.markEvent("scenario.settings.persisted");

  const pickedFolder = await api.dialogs.pickFolder();
  if (!pickedFolder) {
    throw new Error("Folder picker did not return a selection.");
  }
  await bridge.benchmark.markEvent("scenario.dialog.pickFolder", pickedFolder);

  const confirmed = await api.dialogs.confirm("Desktop correctness confirmation");
  if (!confirmed) {
    throw new Error("Confirmation dialog did not return acceptance.");
  }
  await bridge.benchmark.markEvent("scenario.dialog.confirm");

  await api.shell.openExternal("https://example.com/kodocode-desktop-benchmark");
  await bridge.benchmark.markEvent("scenario.shell.openExternal");

  const terminalId = DEFAULT_TERMINAL_ID;
  const cwd = serverConfig.cwd;
  await api.terminal.open({
    threadId: INTERACTION_TERMINAL_THREAD_ID,
    terminalId,
    cwd,
    cols: 100,
    rows: 28,
  });
  await bridge.benchmark.markEvent("scenario.terminal.open");
  const outputPromise = waitForTerminalOutput(api, INTERACTION_TERMINAL_THREAD_ID, terminalId);
  await api.terminal.write({
    threadId: INTERACTION_TERMINAL_THREAD_ID,
    terminalId,
    data: `echo ${BENCHMARK_TERMINAL_SENTINEL}\n`,
  });
  await outputPromise;
  await bridge.benchmark.markEvent("scenario.terminal.output");
  await api.terminal.close({
    threadId: INTERACTION_TERMINAL_THREAD_ID,
    terminalId,
    deleteHistory: true,
  });
  await bridge.benchmark.markEvent("scenario.terminal.close");
}

async function runScenario(
  scenario: string | null,
  api: NativeApi,
  serverConfig: ServerConfig,
): Promise<void> {
  switch (scenario) {
    case null:
    case "":
    case "startup":
      return;
    case "interaction":
    case "correctness":
      await runInteractionScenario(api, serverConfig);
      return;
    case "persistence-verify": {
      const config = await api.server.getConfig();
      if (config.settings.enableAssistantStreaming !== true) {
        throw new Error("Persistence verification failed: expected enableAssistantStreaming=true.");
      }
      return;
    }
    default:
      throw new Error(`Unknown desktop benchmark scenario: ${scenario}`);
  }
}

export function DesktopBenchmarkDriver() {
  const serverConfig = useServerConfig();
  const startedRef = useRef(false);

  useEffect(() => {
    if (!serverConfig || startedRef.current) {
      return;
    }

    const bridge = readDesktopBridge();
    if (!bridge) {
      return;
    }

    startedRef.current = true;
    let cancelled = false;

    void (async () => {
      const state = await bridge.benchmark.getState().catch(() => null);
      if (!state?.enabled || state.completed) {
        return;
      }

      try {
        await runScenario(state.scenario, ensureNativeApi(), serverConfig);
        if (!cancelled) {
          await bridge.benchmark.complete({ success: true });
        }
      } catch (error) {
        if (!cancelled) {
          await bridge.benchmark.complete({
            success: false,
            detail: toErrorMessage(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [serverConfig]);

  return null;
}
