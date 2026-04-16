import * as ChildProcess from "node:child_process";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Net from "node:net";
import * as OS from "node:os";
import * as Path from "node:path";
import { dlopen, FFIType, JSCallback, ptr, type Pointer } from "bun:ffi";

import {
  type ContextMenuItem,
  type DesktopBenchmarkMilestone,
  type DesktopBenchmarkState,
  type DesktopBridgeBootstrap,
  type DesktopResolvedTheme,
  type DesktopTheme,
  type DesktopUpdateActionResult,
  type DesktopUpdateCheckResult,
  type DesktopUpdateState,
} from "@t3tools/contracts";
import {
  createDesktopBenchmarkState,
  createDesktopBridgeBootstrap,
  markDesktopBenchmarkMilestone,
} from "@t3tools/shared/desktop-runtime";
import * as ApplicationMenu from "../../node_modules/electrobun/dist/api/bun/core/ApplicationMenu.ts";
import { BrowserWindow } from "../../node_modules/electrobun/dist/api/bun/core/BrowserWindow.ts";
import * as ContextMenu from "../../node_modules/electrobun/dist/api/bun/core/ContextMenu.ts";
import * as Utils from "../../node_modules/electrobun/dist/api/bun/core/Utils.ts";
import { native, toCString } from "../../node_modules/electrobun/dist/api/bun/proc/native.ts";

function discoverWorkspaceRoot(startDir: string): string | null {
  const explicitRoot = process.env.KODOCODE_ELECTROBUN_SOURCE_ROOT?.trim();
  const candidates = explicitRoot
    ? [Path.resolve(explicitRoot), Path.resolve(startDir)]
    : [Path.resolve(startDir)];

  for (const initialDir of candidates) {
    let currentDir = initialDir;
    while (true) {
      const serverEntry = Path.join(currentDir, "apps/server/dist/bin.mjs");
      const rootPackageJson = Path.join(currentDir, "package.json");
      if (FS.existsSync(serverEntry) && FS.existsSync(rootPackageJson)) {
        return currentDir;
      }

      const parentDir = Path.dirname(currentDir);
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }
  }

  return explicitRoot ? Path.resolve(explicitRoot) : null;
}

const ROOT_DIR = Path.resolve(import.meta.dir, "../../..");
const SOURCE_ROOT = discoverWorkspaceRoot(import.meta.dir) ?? ROOT_DIR;
const DEFAULT_DESKTOP_BACKEND_PORT = 3773;
const MAX_TCP_PORT = 65_535;
const BASE_DIR =
  process.env.KODOCODE_HOME?.trim() ||
  process.env.T3CODE_HOME?.trim() ||
  Path.join(OS.homedir(), ".kodo-code");
const APP_DISPLAY_NAME = process.env.VITE_DEV_SERVER_URL
  ? "Kodo Code (Electrobun Dev)"
  : "Kodo Code (Electrobun Experimental)";
const DESKTOP_UPDATE_DISABLED_MESSAGE =
  "Electrobun updater parity is not implemented yet for this experimental target.";
const AUTOMATION_PICK_FOLDER = process.env.KODOCODE_DESKTOP_AUTOMATION_PICK_FOLDER?.trim() || null;
const AUTOMATION_CONFIRM_RESPONSE = process.env.KODOCODE_DESKTOP_AUTOMATION_CONFIRM_RESPONSE;
const DISABLE_EXTERNAL_OPEN = process.env.KODOCODE_DESKTOP_AUTOMATION_DISABLE_EXTERNAL_OPEN === "1";
const BENCHMARK_RUN_ID = process.env.KODOCODE_DESKTOP_BENCHMARK_RUN_ID?.trim() || null;
const BENCHMARK_SCENARIO = process.env.KODOCODE_DESKTOP_BENCHMARK_SCENARIO?.trim() || null;
const BENCHMARK_OUTPUT_PATH = process.env.KODOCODE_DESKTOP_BENCHMARK_OUTPUT_PATH?.trim() || null;
const BENCHMARK_ENABLED =
  BENCHMARK_OUTPUT_PATH !== null || BENCHMARK_RUN_ID !== null || BENCHMARK_SCENARIO !== null;
const CONTROL_SERVER_HOST = "127.0.0.1";
const DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
const ELECTROBUN_APP_ID = "com.kodo.code.electrobun";
const controlServerToken = Crypto.randomBytes(24).toString("hex");
const SOURCE_BACKEND_ENTRY = Path.join(SOURCE_ROOT, "apps/server/dist/bin.mjs");
const BUNDLED_BACKEND_ENTRY = Path.resolve(import.meta.dir, "../runtime/server-dist/bin.mjs");
const PREFER_SOURCE_BACKEND = FS.existsSync(SOURCE_BACKEND_ENTRY);
const SOURCE_WINDOWS_ICON_PATH = Path.join(SOURCE_ROOT, "assets/prod/kodo-black-windows.ico");
const BUNDLED_WINDOWS_ICON_PATH = Path.resolve(import.meta.dir, "../../app.ico");

const disabledUpdateState: DesktopUpdateState = {
  enabled: false,
  status: "disabled",
  currentVersion: process.env.npm_package_version ?? "0.0.1",
  hostArch: process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : "other",
  appArch: process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : "other",
  runningUnderArm64Translation: false,
  availableVersion: null,
  downloadedVersion: null,
  downloadPercent: null,
  checkedAt: null,
  message: DESKTOP_UPDATE_DISABLED_MESSAGE,
  errorContext: null,
  canRetry: false,
};

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess.ChildProcess | null = null;
let backendPort = 0;
let backendAuthToken = "";
let backendWsUrl = "";
let backendStartPromise: Promise<void> | null = null;
let controlServerPort = 0;
let eventStreamId = 0;
let lastWindowMaximized = false;
let lastResolvedDesktopTheme: DesktopResolvedTheme | null = null;
let pendingContextMenuResolver: ((value: string | null) => void) | null = null;
let startupMilestones = createDesktopBridgeBootstrap({
  runtime: "electrobun",
  wsUrl: null,
  capabilities: {
    updates: false,
    applicationMenu: process.platform === "darwin",
    nativeContextMenu: process.platform !== "linux",
    windowControls: true,
    benchmarkDriver: true,
  },
  startup: {
    processSpawnedAt: new Date().toISOString(),
  },
}).startup;
let benchmarkState: DesktopBenchmarkState = createDesktopBenchmarkState({
  enabled: BENCHMARK_ENABLED,
  runtime: "electrobun",
  runId: BENCHMARK_RUN_ID,
  scenario: BENCHMARK_SCENARIO,
  outputPath: BENCHMARK_OUTPUT_PATH,
  startedAt: startupMilestones.processSpawnedAt,
  startup: startupMilestones,
});

const eventClients = new Map<
  number,
  {
    controller: ReadableStreamDefaultController<Uint8Array>;
    closed: boolean;
  }
>();

const windowsThemeBridge =
  process.platform === "win32"
    ? (() => {
        try {
          const user32 = dlopen("user32.dll", {
            EnumWindows: {
              args: [FFIType.function, FFIType.ptr],
              returns: FFIType.bool,
            },
            GetWindowThreadProcessId: {
              args: [FFIType.ptr, FFIType.ptr],
              returns: FFIType.u32,
            },
            IsWindowVisible: {
              args: [FFIType.ptr],
              returns: FFIType.bool,
            },
          });
          const dwmapi = dlopen("dwmapi.dll", {
            DwmSetWindowAttribute: {
              args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32],
              returns: FFIType.i32,
            },
          });
          const shell32 = dlopen("shell32.dll", {
            SetCurrentProcessExplicitAppUserModelID: {
              args: [FFIType.ptr],
              returns: FFIType.i32,
            },
          });
          return { user32, dwmapi, shell32 };
        } catch (error) {
          console.warn("[electrobun] failed to initialize Windows title bar theme bridge", error);
          return null;
        }
      })()
    : null;

function createDesktopBootstrap(): DesktopBridgeBootstrap {
  return createDesktopBridgeBootstrap({
    runtime: "electrobun",
    wsUrl: backendWsUrl,
    capabilities: {
      updates: false,
      applicationMenu: process.platform !== "linux",
      nativeContextMenu: process.platform !== "linux",
      windowControls: true,
      benchmarkDriver: true,
    },
    startup: startupMilestones,
  });
}

function writeBenchmarkStateToDisk(): void {
  if (!benchmarkState.enabled || !benchmarkState.outputPath) {
    return;
  }

  FS.mkdirSync(Path.dirname(benchmarkState.outputPath), { recursive: true });
  FS.writeFileSync(
    benchmarkState.outputPath,
    `${JSON.stringify(benchmarkState, null, 2)}\n`,
    "utf8",
  );
}

function broadcast(channel: string, payload: unknown): void {
  const encoder = new TextEncoder();
  const message = encoder.encode(`data: ${JSON.stringify({ channel, payload })}\n\n`);
  for (const [id, client] of eventClients) {
    if (client.closed) {
      eventClients.delete(id);
      continue;
    }

    try {
      client.controller.enqueue(message);
    } catch {
      client.closed = true;
      eventClients.delete(id);
    }
  }
}

function setBenchmarkState(patch: Partial<DesktopBenchmarkState>): DesktopBenchmarkState {
  benchmarkState = { ...benchmarkState, ...patch };
  writeBenchmarkStateToDisk();
  broadcast("benchmarkState", benchmarkState);
  return benchmarkState;
}

function markStartupMilestone(
  milestone: DesktopBenchmarkMilestone,
  at = new Date().toISOString(),
): DesktopBenchmarkState {
  startupMilestones = markDesktopBenchmarkMilestone(startupMilestones, milestone, at);
  broadcast("bootstrap", createDesktopBootstrap());
  return setBenchmarkState({ milestones: startupMilestones });
}

function recordBenchmarkEvent(name: string, detail?: string): DesktopBenchmarkState {
  return setBenchmarkState({
    events: benchmarkState.events.concat({
      name,
      at: new Date().toISOString(),
      detail: detail ?? null,
    }),
  });
}

function completeBenchmarkRun(result: {
  readonly success: boolean;
  readonly detail?: string;
}): DesktopBenchmarkState {
  return setBenchmarkState({
    completed: true,
    success: result.success,
    completedAt: new Date().toISOString(),
    status: result.success ? "completed" : "error",
    lastError: result.success ? null : (result.detail ?? benchmarkState.lastError),
    events: benchmarkState.events.concat({
      name: result.success ? "benchmark.complete" : "benchmark.error",
      at: new Date().toISOString(),
      detail: result.detail ?? null,
    }),
  });
}

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type,x-kodocode-token",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "cache-control": "no-store",
    },
  });
}

function readEventField(event: unknown, key: string): unknown {
  if (typeof event !== "object" || event === null) {
    return undefined;
  }

  if (key in event) {
    return (event as Record<string, unknown>)[key];
  }

  const nestedData = "data" in event ? (event as Record<string, unknown>).data : undefined;
  if (typeof nestedData !== "object" || nestedData === null) {
    return undefined;
  }

  return key in nestedData ? (nestedData as Record<string, unknown>)[key] : undefined;
}

function createSseResponse(): Response {
  const encoder = new TextEncoder();
  const streamId = ++eventStreamId;
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        eventClients.set(streamId, { controller, closed: false });
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ channel: "bootstrap", payload: createDesktopBootstrap() })}\n\n`,
          ),
        );
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ channel: "benchmarkState", payload: benchmarkState })}\n\n`,
          ),
        );
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ channel: "updateState", payload: disabledUpdateState })}\n\n`,
          ),
        );
      },
      cancel() {
        eventClients.delete(streamId);
      },
    }),
    {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "access-control-allow-origin": "*",
      },
    },
  );
}

function parseAuthorizedRequest(request: Request): {
  readonly ok: boolean;
  readonly reason?: string;
} {
  const url = new URL(request.url);
  const headerToken = request.headers.get("x-kodocode-token");
  const queryToken = url.searchParams.get("token");
  const token = headerToken ?? queryToken;
  if (token !== controlServerToken) {
    return { ok: false, reason: "unauthorized" };
  }
  return { ok: true };
}

function sanitizeTheme(input: unknown): DesktopTheme | null {
  return input === "light" || input === "dark" || input === "system" ? input : null;
}

function sanitizeResolvedTheme(input: unknown): DesktopResolvedTheme | null {
  return input === "light" || input === "dark" ? input : null;
}

function toWideCString(value: string): Pointer {
  const buffer = new Uint16Array(value.length + 1);
  for (let index = 0; index < value.length; index += 1) {
    buffer[index] = value.charCodeAt(index);
  }
  buffer[value.length] = 0;
  return ptr(buffer);
}

function getWindowsWindowIconPath(): string | null {
  const bundledPath = BUNDLED_WINDOWS_ICON_PATH;
  if (FS.existsSync(bundledPath)) {
    return bundledPath;
  }

  const sourcePath = SOURCE_WINDOWS_ICON_PATH;
  return FS.existsSync(sourcePath) ? sourcePath : null;
}

function configureWindowsShellIdentity(): void {
  if (!windowsThemeBridge) {
    return;
  }

  const result =
    windowsThemeBridge.shell32.symbols.SetCurrentProcessExplicitAppUserModelID(
      toWideCString(ELECTROBUN_APP_ID),
    );
  if (result !== 0) {
    console.warn(
      `[electrobun] failed to set Windows AppUserModelID, HRESULT=${result.toString(16)}`,
    );
  }
}

function listVisibleWindowsForCurrentProcess(): Pointer[] {
  if (!windowsThemeBridge) {
    return [];
  }

  const handles: Pointer[] = [];
  const enumWindowsCallback = new JSCallback(
    (windowHandle: Pointer) => {
      const pidBuffer = new Uint32Array(1);
      windowsThemeBridge.user32.symbols.GetWindowThreadProcessId(windowHandle, ptr(pidBuffer));
      if (pidBuffer[0] !== process.pid) {
        return true;
      }
      if (!windowsThemeBridge.user32.symbols.IsWindowVisible(windowHandle)) {
        return true;
      }

      handles.push(windowHandle);
      return true;
    },
    {
      args: [FFIType.ptr, FFIType.ptr],
      returns: FFIType.bool,
    },
  );

  windowsThemeBridge.user32.symbols.EnumWindows(enumWindowsCallback, null);
  return handles;
}

function applyNativeTitleBarTheme(resolvedTheme: DesktopResolvedTheme): boolean {
  if (!windowsThemeBridge) {
    return false;
  }

  lastResolvedDesktopTheme = resolvedTheme;
  const handles = listVisibleWindowsForCurrentProcess();
  if (handles.length === 0) {
    return true;
  }

  const valueBuffer = new Int32Array([resolvedTheme === "dark" ? 1 : 0]);
  let applied = false;
  for (const windowHandle of handles) {
    const result = windowsThemeBridge.dwmapi.symbols.DwmSetWindowAttribute(
      windowHandle,
      DWMWA_USE_IMMERSIVE_DARK_MODE,
      ptr(valueBuffer),
      valueBuffer.byteLength,
    );
    if (result === 0) {
      applied = true;
    }
  }

  return applied;
}

function applyNativeWindowIcon(window: BrowserWindow): void {
  if (process.platform !== "win32") {
    return;
  }

  const iconPath = getWindowsWindowIconPath();
  if (!iconPath) {
    console.warn("[electrobun] Windows icon file not found for native window icon");
    return;
  }

  try {
    native.symbols.setWindowIcon(window.ptr, toCString(iconPath));
  } catch (error) {
    console.warn("[electrobun] failed to set native window icon", error);
  }
}

function sanitizeExternalUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return null;
  }

  try {
    const parsedUrl = new URL(rawUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }
    return parsedUrl.toString();
  } catch {
    return null;
  }
}

async function canListenOnHost(port: number, host: string): Promise<boolean> {
  try {
    const server = Bun.listen({
      hostname: host,
      port,
      socket: {
        data() {},
      },
    });
    server.stop(true);
    return true;
  } catch {
    return false;
  }
}

async function resolveDesktopBackendPort(
  host: string,
  startPort = DEFAULT_DESKTOP_BACKEND_PORT,
): Promise<number> {
  for (let port = startPort; port <= MAX_TCP_PORT; port += 1) {
    if (await canListenOnHost(port, host)) {
      return port;
    }
  }

  throw new Error(`No desktop backend port is available on ${host} starting at ${startPort}`);
}

function backendChildEnv(input: {
  readonly port: number;
  readonly authToken: string;
}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.T3CODE_DESKTOP_WS_URL;
  delete env.VITE_DEV_SERVER_URL;

  env.KODOCODE_HOME = BASE_DIR;
  env.T3CODE_HOME = BASE_DIR;
  env.T3CODE_MODE = "desktop";
  env.T3CODE_NO_BROWSER = "1";
  env.T3CODE_HOST = "127.0.0.1";
  env.T3CODE_PORT = String(input.port);
  env.T3CODE_AUTH_TOKEN = input.authToken;

  return env;
}

function resolveNodeExecutable(): string {
  const explicitNodeExecutable =
    process.env.KODOCODE_NODE_EXECUTABLE?.trim() || process.env.T3CODE_NODE_EXECUTABLE?.trim();
  if (explicitNodeExecutable) {
    return explicitNodeExecutable;
  }

  const pathEntries = (process.env.PATH ?? "")
    .split(Path.delimiter)
    .filter((entry) => entry.length > 0);
  for (const pathEntry of pathEntries) {
    const nodeExecutable = Path.join(pathEntry, process.platform === "win32" ? "node.exe" : "node");
    if (FS.existsSync(nodeExecutable)) {
      return nodeExecutable;
    }
  }

  if (process.platform === "win32") {
    const programFilesNodeExecutable = Path.join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "nodejs",
      "node.exe",
    );
    if (FS.existsSync(programFilesNodeExecutable)) {
      return programFilesNodeExecutable;
    }
  }

  throw new Error("Node.js executable is required to launch the desktop backend on this platform.");
}

function resolveBackendEntry(): string {
  if (PREFER_SOURCE_BACKEND && FS.existsSync(SOURCE_BACKEND_ENTRY)) {
    return SOURCE_BACKEND_ENTRY;
  }

  if (FS.existsSync(BUNDLED_BACKEND_ENTRY)) {
    return BUNDLED_BACKEND_ENTRY;
  }

  return SOURCE_BACKEND_ENTRY;
}

function isSourceBackendEntry(entry: string): boolean {
  return Path.resolve(entry) === Path.resolve(SOURCE_BACKEND_ENTRY);
}

async function refreshDesktopBackendConnectionEndpoint(): Promise<void> {
  backendPort = await resolveDesktopBackendPort("127.0.0.1");
  backendWsUrl = `ws://127.0.0.1:${backendPort}/?token=${encodeURIComponent(backendAuthToken)}`;
  recordBenchmarkEvent("backend.endpoint.resolved", backendWsUrl);
}

function canConnectToBackendPort(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Net.Socket();
    let settled = false;

    const finish = (connected: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(connected);
    };

    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function waitForBackendReady(options?: {
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
}): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const pollIntervalMs = options?.pollIntervalMs ?? 150;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await canConnectToBackendPort(backendPort)) {
      recordBenchmarkEvent("backend.ready", `port=${backendPort}`);
      return;
    }

    if (backendProcess && backendProcess.exitCode !== null) {
      throw new Error(
        `Electrobun backend exited before it became ready (code=${backendProcess.exitCode})`,
      );
    }
    if (backendProcess && backendProcess.signalCode !== null) {
      throw new Error(
        `Electrobun backend exited before it became ready (signal=${backendProcess.signalCode})`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Timed out waiting for Electrobun backend on 127.0.0.1:${backendPort}`);
}

async function startBackend(): Promise<void> {
  if (backendProcess) {
    return;
  }
  if (backendStartPromise) {
    await backendStartPromise;
    return;
  }

  backendStartPromise = (async () => {
    const backendEntry = resolveBackendEntry();
    if (!FS.existsSync(backendEntry)) {
      throw new Error(`Electrobun backend entry is missing at ${backendEntry}`);
    }

    await refreshDesktopBackendConnectionEndpoint();
    const backendCommand =
      process.platform === "win32" ? resolveNodeExecutable() : process.execPath;

    const child = ChildProcess.spawn(backendCommand, [backendEntry, "--bootstrap-fd", "3"], {
      cwd:
        process.env.VITE_DEV_SERVER_URL || isSourceBackendEntry(backendEntry)
          ? SOURCE_ROOT
          : OS.homedir(),
      env: backendChildEnv({
        port: backendPort,
        authToken: backendAuthToken,
      }),
      stdio: ["ignore", "inherit", "inherit", "pipe"],
    });
    const bootstrapStream = child.stdio[3];
    if (bootstrapStream && "write" in bootstrapStream) {
      bootstrapStream.write(
        `${JSON.stringify({
          mode: "desktop",
          noBrowser: true,
          port: backendPort,
          t3Home: BASE_DIR,
          authToken: backendAuthToken,
        })}\n`,
      );
      bootstrapStream.end();
    } else {
      child.kill("SIGTERM");
      throw new Error("Electrobun backend bootstrap pipe is unavailable");
    }

    backendProcess = child;
    child.once("exit", (code, signal) => {
      if (backendProcess === child) {
        backendProcess = null;
      }
      if (code !== 0 || signal !== null) {
        recordBenchmarkEvent("backend.exit", `code=${code ?? "null"} signal=${signal ?? "null"}`);
      }
    });
  })().finally(() => {
    backendStartPromise = null;
  });

  await backendStartPromise;
}

async function stopBackend(): Promise<void> {
  const child = backendProcess;
  backendProcess = null;
  if (!child) {
    return;
  }

  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };

    child.once("exit", finish);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      finish();
    }, 2_000).unref();
  });
}

async function pickFolder(): Promise<string | null> {
  if (AUTOMATION_PICK_FOLDER) {
    return AUTOMATION_PICK_FOLDER;
  }

  const paths = await Utils.openFileDialog({
    startingFolder: BASE_DIR,
    allowedFileTypes: "*",
    canChooseFiles: false,
    canChooseDirectory: true,
    allowsMultipleSelection: false,
  });
  return paths[0] ?? null;
}

async function confirmMessage(message: string): Promise<boolean> {
  if (AUTOMATION_CONFIRM_RESPONSE === "0") {
    return false;
  }
  if (AUTOMATION_CONFIRM_RESPONSE === "1") {
    return true;
  }

  const { response } = await Utils.showMessageBox({
    type: "question",
    title: APP_DISPLAY_NAME,
    message,
    buttons: ["Cancel", "OK"],
    defaultId: 1,
    cancelId: 0,
  });
  return response === 1;
}

function configureApplicationMenu(): void {
  if (process.platform === "linux" || process.platform === "win32") {
    return;
  }

  ApplicationMenu.setApplicationMenu([
    {
      label: APP_DISPLAY_NAME,
      submenu: [
        {
          label: "Settings...",
          action: "open-settings",
          accelerator: "CmdOrCtrl+,",
        },
        {
          type: "separator",
        },
        {
          label: process.platform === "darwin" ? "Close Window" : "Quit",
          action: process.platform === "darwin" ? "close-window" : "quit-app",
        },
      ],
    },
  ]);
}

function resolveMainViewUrl(): string {
  if (process.env.VITE_DEV_SERVER_URL) {
    return process.env.VITE_DEV_SERVER_URL;
  }

  return "views://mainview/index.html";
}

function emitMaximizedChange(): void {
  const isMaximized = mainWindow?.isMaximized() ?? false;
  if (isMaximized === lastWindowMaximized) {
    return;
  }

  lastWindowMaximized = isMaximized;
  broadcast("windowMaximizedChange", isMaximized);
}

function createPreloadScript(): string {
  const bootstrap = JSON.stringify(createDesktopBootstrap());
  const baseUrl = JSON.stringify(`http://${CONTROL_SERVER_HOST}:${controlServerPort}`);
  const token = JSON.stringify(controlServerToken);
  return `
(() => {
  const bootstrap = ${bootstrap};
  const baseUrl = ${baseUrl};
  const token = ${token};
  const listeners = new Map();
  let eventSource = null;

  const subscribe = (channel, listener) => {
    let handlers = listeners.get(channel);
    if (!handlers) {
      handlers = new Set();
      listeners.set(channel, handlers);
    }
    handlers.add(listener);
    if (!eventSource) {
      eventSource = new EventSource(baseUrl + "/events?token=" + encodeURIComponent(token));
      eventSource.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const channelListeners = listeners.get(message.channel);
          if (!channelListeners) return;
          for (const handler of channelListeners) {
            handler(message.payload);
          }
        } catch (error) {
          console.error("[electrobun-bridge] failed to parse event stream payload", error);
        }
      };
    }
    return () => {
      const current = listeners.get(channel);
      if (!current) return;
      current.delete(listener);
    };
  };

  const request = async (path, body) => {
    const response = await fetch(baseUrl + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-kodocode-token": token,
      },
      body: JSON.stringify(body ?? {}),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || ("Request failed: " + path));
    }
    return response.json();
  };

  window.desktopBridge = {
    bootstrap,
    pickFolder: () => request("/pick-folder"),
    confirm: (message) => request("/confirm", { message }),
    setTheme: (theme, options) => request("/set-theme", { theme, options }).then(() => undefined),
    showContextMenu: (items, position) => request("/context-menu", { items, position }),
    openExternal: (url) => request("/open-external", { url }),
    onMenuAction: (listener) => subscribe("menuAction", listener),
    getUpdateState: () => request("/update/state"),
    checkForUpdate: () => request("/update/check"),
    downloadUpdate: () => request("/update/download"),
    installUpdate: () => request("/update/install"),
    onUpdateState: (listener) => subscribe("updateState", listener),
    windowControls: {
      minimize: () => {
        void request("/window/minimize");
      },
      toggleMaximize: () => {
        void request("/window/toggle-maximize");
      },
      close: () => {
        void request("/window/close");
      },
      isMaximized: () => request("/window/is-maximized"),
      onMaximizedChange: (listener) => subscribe("windowMaximizedChange", listener),
    },
    benchmark: {
      getState: () => request("/benchmark/get-state"),
      onState: (listener) => subscribe("benchmarkState", listener),
      markMilestone: (milestone) => request("/benchmark/mark-milestone", { milestone }),
      markEvent: (name, detail) => request("/benchmark/mark-event", { name, detail }),
      complete: (result) => request("/benchmark/complete", result),
    },
  };
})();
`;
}

function createWindow(): BrowserWindow {
  const titleBarStyle =
    process.platform === "darwin"
      ? "hiddenInset"
      : process.platform === "linux"
        ? "hidden"
        : "default";

  const window = new BrowserWindow({
    title: APP_DISPLAY_NAME,
    url: resolveMainViewUrl(),
    preload: createPreloadScript(),
    frame: {
      x: 120,
      y: 120,
      width: 1100,
      height: 780,
    },
    hidden: true,
    titleBarStyle,
  });

  mainWindow = window;
  markStartupMilestone("firstWindowCreated");
  lastWindowMaximized = window.isMaximized();
  applyNativeWindowIcon(window);
  if (lastResolvedDesktopTheme) {
    applyNativeTitleBarTheme(lastResolvedDesktopTheme);
  }

  window.webview.on("dom-ready", () => {
    if (!mainWindow) {
      return;
    }
    mainWindow.show();
    markStartupMilestone("firstWindowShown");
  });

  window.on("resize", () => {
    emitMaximizedChange();
  });

  window.on("close", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  return window;
}

async function handleRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return createJsonResponse({ ok: true });
  }

  const auth = parseAuthorizedRequest(request);
  if (!auth.ok) {
    return createJsonResponse({ error: auth.reason }, 401);
  }

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/events") {
    return createSseResponse();
  }

  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};

  switch (url.pathname) {
    case "/pick-folder":
      return createJsonResponse(await pickFolder());
    case "/confirm":
      return createJsonResponse(
        typeof body.message === "string" ? await confirmMessage(body.message) : false,
      );
    case "/set-theme":
      return createJsonResponse({
        accepted:
          sanitizeTheme(body.theme) !== null &&
          (() => {
            const resolvedTheme = sanitizeResolvedTheme(body.options?.resolvedTheme);
            if (!resolvedTheme) {
              return true;
            }
            return applyNativeTitleBarTheme(resolvedTheme);
          })(),
      });
    case "/context-menu": {
      if (process.platform === "linux" || !Array.isArray(body.items)) {
        return createJsonResponse(null);
      }

      const items = body.items
        .filter(
          (item: unknown): item is ContextMenuItem => typeof item === "object" && item !== null,
        )
        .filter((item) => typeof item.id === "string" && typeof item.label === "string");
      if (items.length === 0) {
        return createJsonResponse(null);
      }

      return createJsonResponse(
        await new Promise<string | null>((resolve) => {
          pendingContextMenuResolver = resolve;
          ContextMenu.showContextMenu(
            items.map((item) => ({
              label: item.label,
              action: "desktop-context-item",
              data: item.id,
              enabled: item.disabled !== true,
            })),
          );
          setTimeout(() => {
            if (pendingContextMenuResolver !== resolve) {
              return;
            }
            pendingContextMenuResolver = null;
            resolve(null);
          }, 10_000).unref();
        }),
      );
    }
    case "/open-external": {
      const externalUrl = sanitizeExternalUrl(body.url);
      if (!externalUrl) {
        return createJsonResponse(false);
      }
      if (DISABLE_EXTERNAL_OPEN) {
        recordBenchmarkEvent("shell.openExternal.suppressed", externalUrl);
        return createJsonResponse(true);
      }
      return createJsonResponse(Utils.openExternal(externalUrl));
    }
    case "/update/state":
      return createJsonResponse(disabledUpdateState);
    case "/update/check":
      return createJsonResponse({
        checked: false,
        state: disabledUpdateState,
      } satisfies DesktopUpdateCheckResult);
    case "/update/download":
    case "/update/install":
      return createJsonResponse({
        accepted: false,
        completed: false,
        state: disabledUpdateState,
      } satisfies DesktopUpdateActionResult);
    case "/window/minimize":
      mainWindow?.minimize();
      return createJsonResponse({ ok: true });
    case "/window/toggle-maximize":
      if (mainWindow) {
        if (mainWindow.isMaximized()) {
          mainWindow.unmaximize();
        } else {
          mainWindow.maximize();
        }
        emitMaximizedChange();
      }
      return createJsonResponse({ ok: true });
    case "/window/close":
      mainWindow?.close();
      return createJsonResponse({ ok: true });
    case "/window/is-maximized":
      return createJsonResponse(mainWindow?.isMaximized() ?? false);
    case "/benchmark/get-state":
      return createJsonResponse(benchmarkState);
    case "/benchmark/mark-milestone":
      if (
        body.milestone !== "processSpawned" &&
        body.milestone !== "firstWindowCreated" &&
        body.milestone !== "firstWindowShown" &&
        body.milestone !== "rendererBootstrap" &&
        body.milestone !== "rendererReady" &&
        body.milestone !== "backendConnected"
      ) {
        return createJsonResponse(benchmarkState);
      }
      return createJsonResponse(markStartupMilestone(body.milestone));
    case "/benchmark/mark-event":
      return createJsonResponse(
        typeof body.name === "string" && body.name.trim().length > 0
          ? recordBenchmarkEvent(
              body.name.trim(),
              typeof body.detail === "string" && body.detail.trim().length > 0
                ? body.detail.trim()
                : undefined,
            )
          : benchmarkState,
      );
    case "/benchmark/complete":
      return createJsonResponse(
        completeBenchmarkRun({
          success: body.success === true,
          ...(typeof body.detail === "string" && body.detail.trim().length > 0
            ? { detail: body.detail.trim() }
            : {}),
        }),
      );
    default:
      return createJsonResponse({ error: "not-found" }, 404);
  }
}

async function startControlServer(): Promise<void> {
  if (controlServerPort !== 0) {
    return;
  }

  const server = Bun.serve({
    hostname: CONTROL_SERVER_HOST,
    port: 0,
    fetch: (request) => handleRequest(request),
  });
  controlServerPort = server.port;
}

function registerMenuHandlers(): void {
  ApplicationMenu.on("application-menu-clicked", (event) => {
    const action = readEventField(event, "action");
    const normalizedAction = typeof action === "string" ? action : null;
    if (!normalizedAction) {
      return;
    }

    if (normalizedAction === "quit-app") {
      void stopBackend().finally(() => {
        process.exit(0);
      });
      return;
    }
    if (normalizedAction === "close-window") {
      mainWindow?.close();
      return;
    }
    if (normalizedAction === "check-for-updates") {
      broadcast("updateState", disabledUpdateState);
      return;
    }

    broadcast("menuAction", normalizedAction);
  });

  ContextMenu.on("context-menu-clicked", (event) => {
    const data = readEventField(event, "data");
    const selectedId = typeof data === "string" && data.length > 0 ? data : null;
    pendingContextMenuResolver?.(selectedId);
    pendingContextMenuResolver = null;
  });
}

async function bootstrap(): Promise<void> {
  backendAuthToken = Crypto.randomBytes(24).toString("hex");
  configureWindowsShellIdentity();
  registerMenuHandlers();
  configureApplicationMenu();
  await startBackend();
  await waitForBackendReady();
  createWindow();
}

recordBenchmarkEvent("app.ready");
void startControlServer()
  .then(() => bootstrap())
  .catch((error) => {
    completeBenchmarkRun({
      success: false,
      detail: error instanceof Error ? error.message : String(error),
    });
    console.error("[electrobun] bootstrap failed", error);
    process.exit(1);
  });

process.on("SIGINT", () => {
  void stopBackend().finally(() => {
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  void stopBackend().finally(() => {
    process.exit(0);
  