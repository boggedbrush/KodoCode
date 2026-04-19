#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { NetService } from "@t3tools/shared/Net";
import { Config, Data, Effect, Hash, Layer, Logger, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { ChildProcess } from "effect/unstable/process";

const BASE_SERVER_PORT = 3773;
const BASE_WEB_PORT = 5733;
const MAX_HASH_OFFSET = 3000;
const MAX_PORT = 65535;
const DESKTOP_DEV_RUNNER_PID_ENV = "KODOCODE_DEV_RUNNER_PID";
const DESKTOP_DEV_SHUTDOWN_SIGNAL_ENV = "KODOCODE_DEV_SHUTDOWN_SIGNAL";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);

function encodeBooleanEnv(value: boolean): string {
  return value ? "true" : "false";
}

function resolveTurboCommand(): string {
  const candidatePaths =
    process.platform === "win32"
      ? [
          join(REPO_ROOT, "node_modules", ".bin", "turbo.exe"),
          join(REPO_ROOT, "node_modules", ".bin", "turbo.cmd"),
        ]
      : [join(REPO_ROOT, "node_modules", ".bin", "turbo")];

  return candidatePaths.find((candidate) => existsSync(candidate)) ?? "turbo";
}

function resolveBunCommand(): string {
  const candidate = process.env.BUN_BINARY?.trim();
  if (candidate && existsSync(candidate)) {
    return candidate;
  }

  const candidatePaths =
    process.platform === "win32"
      ? [
          join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links", "bun.exe"),
          join(
            process.env.LOCALAPPDATA ?? "",
            "Microsoft",
            "WinGet",
            "Packages",
            "Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe",
            "bun-windows-x64",
            "bun.exe",
          ),
        ]
      : [join(process.env.HOME ?? "", ".bun", "bin", "bun")];

  return candidatePaths.find((entry) => entry && existsSync(entry)) ?? "bun";
}

export const DESKTOP_DEV_SHUTDOWN_SIGNAL: NodeJS.Signals =
  process.platform === "win32" ? "SIGTERM" : "SIGUSR2";

export const DEFAULT_KODO_HOME = Effect.map(Effect.service(Path.Path), (path) =>
  path.join(homedir(), ".kodo-code"),
);

const MODE_ARGS = {
  dev: [
    "run",
    "dev",
    "--ui=tui",
    "--filter=@t3tools/contracts",
    "--filter=@t3tools/web",
    "--filter=kodo",
    "--parallel",
  ],
  "dev:server": ["run", "dev", "--filter=kodo"],
  "dev:web": ["run", "dev", "--filter=@t3tools/web"],
  "dev:desktop": ["run", "dev", "--filter=@t3tools/desktop", "--filter=@t3tools/web", "--parallel"],
} as const satisfies Record<string, ReadonlyArray<string>>;

type DevMode = keyof typeof MODE_ARGS;
type PortAvailabilityCheck<R = never> = (port: number) => Effect.Effect<boolean, never, R>;

const DEV_RUNNER_MODES = Object.keys(MODE_ARGS) as Array<DevMode>;

class DevRunnerError extends Data.TaggedError("DevRunnerError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const optionalStringConfig = (name: string): Config.Config<string | undefined> =>
  Config.string(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );
const optionalBooleanConfig = (name: string): Config.Config<boolean | undefined> =>
  Config.boolean(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );
const optionalPortConfig = (name: string): Config.Config<number | undefined> =>
  Config.port(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );
const optionalIntegerConfig = (name: string): Config.Config<number | undefined> =>
  Config.int(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );
const optionalUrlConfig = (name: string): Config.Config<URL | undefined> =>
  Config.url(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );

const OffsetConfig = Config.all({
  portOffset: optionalIntegerConfig("T3CODE_PORT_OFFSET"),
  devInstance: optionalStringConfig("T3CODE_DEV_INSTANCE"),
});

export function resolveOffset(config: {
  readonly portOffset: number | undefined;
  readonly devInstance: string | undefined;
}): { readonly offset: number; readonly source: string } {
  if (config.portOffset !== undefined) {
    if (config.portOffset < 0) {
      throw new Error(`Invalid T3CODE_PORT_OFFSET: ${config.portOffset}`);
    }
    return {
      offset: config.portOffset,
      source: `T3CODE_PORT_OFFSET=${config.portOffset}`,
    };
  }

  const seed = config.devInstance?.trim();
  if (!seed) {
    return { offset: 0, source: "default ports" };
  }

  if (/^\d+$/.test(seed)) {
    return { offset: Number(seed), source: `numeric T3CODE_DEV_INSTANCE=${seed}` };
  }

  const offset = ((Hash.string(seed) >>> 0) % MAX_HASH_OFFSET) + 1;
  return { offset, source: `hashed T3CODE_DEV_INSTANCE=${seed}` };
}

function resolveBaseDir(baseDir: string | undefined): Effect.Effect<string, never, Path.Path> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const configured = baseDir?.trim();

    if (configured) {
      return path.resolve(configured);
    }

    return yield* DEFAULT_KODO_HOME;
  });
}

interface CreateDevRunnerEnvInput {
  readonly mode: DevMode;
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly serverOffset: number;
  readonly webOffset: number;
  readonly t3Home: string | undefined;
  readonly authToken: string | undefined;
  readonly noBrowser: boolean | undefined;
  readonly autoBootstrapProjectFromCwd: boolean | undefined;
  readonly logWebSocketEvents: boolean | undefined;
  readonly host: string | undefined;
  readonly port: number | undefined;
  readonly devUrl: URL | undefined;
  readonly desktopDevRunnerPid?: number | undefined;
  readonly desktopDevShutdownSignal?: NodeJS.Signals | undefined;
}

export function createDevRunnerEnv({
  mode,
  baseEnv,
  serverOffset,
  webOffset,
  t3Home,
  authToken,
  noBrowser,
  autoBootstrapProjectFromCwd,
  logWebSocketEvents,
  host,
  port,
  devUrl,
  desktopDevRunnerPid,
  desktopDevShutdownSignal,
}: CreateDevRunnerEnvInput): Effect.Effect<NodeJS.ProcessEnv, never, Path.Path> {
  return Effect.gen(function* () {
    const serverPort = port ?? BASE_SERVER_PORT + serverOffset;
    const webPort = BASE_WEB_PORT + webOffset;
    const resolvedBaseDir = yield* resolveBaseDir(t3Home);
    const isDesktopMode = mode === "dev:desktop";

    const output: NodeJS.ProcessEnv = {
      ...baseEnv,
      PORT: String(webPort),
      ELECTRON_RENDERER_PORT: String(webPort),
      VITE_DEV_SERVER_URL: devUrl?.toString() ?? `http://localhost:${webPort}`,
      KODOCODE_HOME: resolvedBaseDir,
      T3CODE_HOME: resolvedBaseDir,
    };

    if (!isDesktopMode) {
      output.T3CODE_PORT = String(serverPort);
      output.VITE_WS_URL = `ws://localhost:${serverPort}`;
    } else {
      delete output.T3CODE_PORT;
      delete output.VITE_WS_URL;
      delete output.T3CODE_AUTH_TOKEN;
      delete output.T3CODE_MODE;
      delete output.T3CODE_NO_BROWSER;
      delete output.T3CODE_HOST;
    }

    if (!isDesktopMode && host !== undefined) {
      output.T3CODE_HOST = host;
    }

    if (!isDesktopMode && authToken !== undefined) {
      output.T3CODE_AUTH_TOKEN = authToken;
    } else if (!isDesktopMode) {
      delete output.T3CODE_AUTH_TOKEN;
    }

    if (!isDesktopMode && noBrowser !== undefined) {
      output.T3CODE_NO_BROWSER = encodeBooleanEnv(noBrowser);
    } else if (!isDesktopMode) {
      delete output.T3CODE_NO_BROWSER;
    }

    if (autoBootstrapProjectFromCwd !== undefined) {
      output.T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD = encodeBooleanEnv(autoBootstrapProjectFromCwd);
    } else {
      delete output.T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD;
    }

    if (logWebSocketEvents !== undefined) {
      output.T3CODE_LOG_WS_EVENTS = encodeBooleanEnv(logWebSocketEvents);
    } else {
      delete output.T3CODE_LOG_WS_EVENTS;
    }

    if (mode === "dev") {
      output.T3CODE_MODE = "web";
      delete output.T3CODE_DESKTOP_WS_URL;
    }

    if (mode === "dev:server" || mode === "dev:web") {
      output.T3CODE_MODE = "web";
      delete output.T3CODE_DESKTOP_WS_URL;
    }

    if (isDesktopMode) {
      delete output.T3CODE_DESKTOP_WS_URL;
      if (desktopDevRunnerPid !== undefined) {
        output[DESKTOP_DEV_RUNNER_PID_ENV] = String(desktopDevRunnerPid);
      } else {
        delete output[DESKTOP_DEV_RUNNER_PID_ENV];
      }
      if (desktopDevShutdownSignal !== undefined) {
        output[DESKTOP_DEV_SHUTDOWN_SIGNAL_ENV] = desktopDevShutdownSignal;
      } else {
        delete output[DESKTOP_DEV_SHUTDOWN_SIGNAL_ENV];
      }
    } else {
      delete output[DESKTOP_DEV_RUNNER_PID_ENV];
      delete output[DESKTOP_DEV_SHUTDOWN_SIGNAL_ENV];
    }

    return output;
  });
}

function signalExitCode(signal: NodeJS.Signals): number {
  switch (signal) {
    case "SIGHUP":
      return 129;
    case "SIGINT":
      return 130;
    case "SIGTERM":
      return 143;
    default:
      return 0;
  }
}

export function getWindowsTaskkillArgs(
  pid: number,
  signal: NodeJS.Signals,
): ReadonlyArray<string> | null {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }

  return ["/PID", String(pid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])];
}

function terminateProcessTree(pid: number, signal: NodeJS.Signals): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  if (process.platform === "win32") {
    const taskkillArgs = getWindowsTaskkillArgs(pid, signal);
    if (taskkillArgs === null) {
      return;
    }

    spawnSync("taskkill", taskkillArgs, { stdio: "ignore", windowsHide: true });
    return;
  }

  try {
    process.kill(pid, signal);
  } catch {
    // Best-effort shutdown. The child may have already exited.
  }

  const pkillSignal = signal.replace(/^SIG/, "");
  spawnSync("pkill", [`-${pkillSignal}`, "-P", String(pid)], { stdio: "ignore" });
}

function portPairForOffset(offset: number): {
  readonly serverPort: number;
  readonly webPort: number;
} {
  return {
    serverPort: BASE_SERVER_PORT + offset,
    webPort: BASE_WEB_PORT + offset,
  };
}

const defaultCheckPortAvailability: PortAvailabilityCheck<NetService> = (port) =>
  Effect.gen(function* () {
    const net = yield* NetService;
    return yield* net.isPortAvailableOnLoopback(port);
  });

interface FindFirstAvailableOffsetInput<R = NetService> {
  readonly startOffset: number;
  readonly requireServerPort: boolean;
  readonly requireWebPort: boolean;
  readonly checkPortAvailability?: PortAvailabilityCheck<R>;
}

export function findFirstAvailableOffset<R = NetService>({
  startOffset,
  requireServerPort,
  requireWebPort,
  checkPortAvailability,
}: FindFirstAvailableOffsetInput<R>): Effect.Effect<number, DevRunnerError, R> {
  return Effect.gen(function* () {
    const checkPort = (checkPortAvailability ??
      defaultCheckPortAvailability) as PortAvailabilityCheck<R>;

    for (let candidate = startOffset; ; candidate += 1) {
      const { serverPort, webPort } = portPairForOffset(candidate);
      const serverPortOutOfRange = serverPort > MAX_PORT;
      const webPortOutOfRange = webPort > MAX_PORT;

      if (
        (requireServerPort && serverPortOutOfRange) ||
        (requireWebPort && webPortOutOfRange) ||
        (!requireServerPort && !requireWebPort && (serverPortOutOfRange || webPortOutOfRange))
      ) {
        break;
      }

      const checks: Array<Effect.Effect<boolean, never, R>> = [];
      if (requireServerPort) {
        checks.push(checkPort(serverPort));
      }
      if (requireWebPort) {
        checks.push(checkPort(webPort));
      }

      if (checks.length === 0) {
        return candidate;
      }

      const availability = yield* Effect.all(checks);
      if (availability.every(Boolean)) {
        return candidate;
      }
    }

    return yield* new DevRunnerError({
      message: `No available dev ports found from offset ${startOffset}. Tried server=${BASE_SERVER_PORT}+n web=${BASE_WEB_PORT}+n up to port ${MAX_PORT}.`,
    });
  });
}

interface ResolveModePortOffsetsInput<R = NetService> {
  readonly mode: DevMode;
  readonly startOffset: number;
  readonly hasExplicitServerPort: boolean;
  readonly hasExplicitDevUrl: boolean;
  readonly checkPortAvailability?: PortAvailabilityCheck<R>;
}

export function resolveModePortOffsets<R = NetService>({
  mode,
  startOffset,
  hasExplicitServerPort,
  hasExplicitDevUrl,
  checkPortAvailability,
}: ResolveModePortOffsetsInput<R>): Effect.Effect<
  { readonly serverOffset: number; readonly webOffset: number },
  DevRunnerError,
  R
> {
  return Effect.gen(function* () {
    const checkPort = (checkPortAvailability ??
      defaultCheckPortAvailability) as PortAvailabilityCheck<R>;

    if (mode === "dev:web") {
      if (hasExplicitDevUrl) {
        return { serverOffset: startOffset, webOffset: startOffset };
      }

      const webOffset = yield* findFirstAvailableOffset({
        startOffset,
        requireServerPort: false,
        requireWebPort: true,
        checkPortAvailability: checkPort,
      });
      return { serverOffset: startOffset, webOffset };
    }

    if (mode === "dev:server") {
      if (hasExplicitServerPort) {
        return { serverOffset: startOffset, webOffset: startOffset };
      }

      const serverOffset = yield* findFirstAvailableOffset({
        startOffset,
        requireServerPort: true,
        requireWebPort: false,
        checkPortAvailability: checkPort,
      });
      return { serverOffset, webOffset: serverOffset };
    }

    const sharedOffset = yield* findFirstAvailableOffset({
      startOffset,
      requireServerPort: !hasExplicitServerPort,
      requireWebPort: !hasExplicitDevUrl,
      checkPortAvailability: checkPort,
    });

    return { serverOffset: sharedOffset, webOffset: sharedOffset };
  });
}

interface DevRunnerCliInput {
  readonly mode: DevMode;
  readonly t3Home: string | undefined;
  readonly authToken: string | undefined;
  readonly noBrowser: boolean | undefined;
  readonly autoBootstrapProjectFromCwd: boolean | undefined;
  readonly logWebSocketEvents: boolean | undefined;
  readonly host: string | undefined;
  readonly port: number | undefined;
  readonly devUrl: URL | undefined;
  readonly dryRun: boolean;
  readonly turboArgs: ReadonlyArray<string>;
}

export function isInheritedDesktopDevUrl(
  baseEnv: NodeJS.ProcessEnv,
  devUrl: URL | undefined,
): devUrl is URL {
  if (devUrl === undefined) {
    return false;
  }

  const port = baseEnv.PORT?.trim();
  const rendererPort = baseEnv.ELECTRON_RENDERER_PORT?.trim();
  const rawDevUrl = baseEnv.VITE_DEV_SERVER_URL?.trim();
  if (!port || !rendererPort || !rawDevUrl || port !== rendererPort) {
    return false;
  }

  let envDevUrl: URL;
  try {
    envDevUrl = new URL(rawDevUrl);
  } catch {
    return false;
  }

  return (
    devUrl.toString() === envDevUrl.toString() &&
    devUrl.hostname === "localhost" &&
    devUrl.port === port &&
    (devUrl.pathname === "/" || devUrl.pathname === "")
  );
}

const readOptionalBooleanEnv = (name: string): boolean | undefined => {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }
  if (value === "1" || value.toLowerCase() === "true") {
    return true;
  }
  if (value === "0" || value.toLowerCase() === "false") {
    return false;
  }
  return undefined;
};

const resolveOptionalBooleanOverride = (
  explicitValue: boolean | undefined,
  envValue: boolean | undefined,
): boolean | undefined => {
  if (explicitValue === true) {
    return true;
  }

  if (explicitValue === false) {
    return envValue;
  }

  return envValue;
};

export function runDevRunnerWithInput(input: DevRunnerCliInput) {
  return Effect.gen(function* () {
    const { portOffset, devInstance } = yield* OffsetConfig.asEffect().pipe(
      Effect.mapError(
        (cause) =>
          new DevRunnerError({
            message: "Failed to read T3CODE_PORT_OFFSET/T3CODE_DEV_INSTANCE configuration.",
            cause,
          }),
      ),
    );

    const { offset, source } = yield* Effect.try({
      try: () => resolveOffset({ portOffset, devInstance }),
      catch: (cause) =>
        new DevRunnerError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    const envOverrides = {
      noBrowser: readOptionalBooleanEnv("T3CODE_NO_BROWSER"),
      autoBootstrapProjectFromCwd: readOptionalBooleanEnv("T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD"),
      logWebSocketEvents: readOptionalBooleanEnv("T3CODE_LOG_WS_EVENTS"),
    };

    const inheritedDesktopDevUrl =
      input.mode === "dev:desktop" && isInheritedDesktopDevUrl(process.env, input.devUrl);
    const effectiveDevUrl = inheritedDesktopDevUrl ? undefined : input.devUrl;

    const { serverOffset, webOffset } = yield* resolveModePortOffsets({
      mode: input.mode,
      startOffset: offset,
      hasExplicitServerPort: input.port !== undefined,
      hasExplicitDevUrl: effectiveDevUrl !== undefined,
    });

    const env = yield* createDevRunnerEnv({
      mode: input.mode,
      baseEnv: process.env,
      serverOffset,
      webOffset,
      t3Home: input.t3Home,
      authToken: input.authToken,
      noBrowser: resolveOptionalBooleanOverride(input.noBrowser, envOverrides.noBrowser),
      autoBootstrapProjectFromCwd: resolveOptionalBooleanOverride(
        input.autoBootstrapProjectFromCwd,
        envOverrides.autoBootstrapProjectFromCwd,
      ),
      logWebSocketEvents: resolveOptionalBooleanOverride(
        input.logWebSocketEvents,
        envOverrides.logWebSocketEvents,
      ),
      host: input.host,
      port: input.port,
      devUrl: effectiveDevUrl,
      desktopDevRunnerPid: input.mode === "dev:desktop" ? process.pid : undefined,
      desktopDevShutdownSignal:
        input.mode === "dev:desktop" ? DESKTOP_DEV_SHUTDOWN_SIGNAL : undefined,
    });

    const selectionSuffix =
      serverOffset !== offset || webOffset !== offset
        ? ` selectedOffset(server=${serverOffset},web=${webOffset})`
        : "";

    yield* Effect.logInfo(
      `[dev-runner] mode=${input.mode} source=${source}${selectionSuffix} serverPort=${String(env.T3CODE_PORT)} webPort=${String(env.PORT)} baseDir=${String(env.KODOCODE_HOME ?? env.T3CODE_HOME)}`,
    );

    if (input.dryRun) {
      return;
    }

    const command = input.mode === "dev:server" ? resolveBunCommand() : resolveTurboCommand();
    const args =
      input.mode === "dev:server"
        ? ["run", "src/bin.ts"]
        : [...MODE_ARGS[input.mode], ...input.turboArgs];
    const cwd = input.mode === "dev:server" ? join(REPO_ROOT, "apps", "server") : undefined;

    if (input.mode === "dev:server") {
      const contractsBuild = yield* ChildProcess.make(command, ["run", "build"], {
        cwd: join(REPO_ROOT, "packages", "contracts"),
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        env,
        extendEnv: false,
        shell: process.platform === "win32" && !command.includes("\\"),
        detached: false,
        forceKillAfter: "1500 millis",
      });
      const buildExitCode = yield* contractsBuild.exitCode;
      if (buildExitCode !== 0) {
        return yield* new DevRunnerError({
          message: `contracts build exited with code ${buildExitCode}`,
        });
      }
    }

    const child = yield* ChildProcess.make(command, args, {
      cwd,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env,
      extendEnv: false,
      shell: process.platform === "win32" && !command.includes("\\"),
      // Keep the child in the same process group so terminal signals (Ctrl+C)
      // reach it directly.
      detached: false,
      forceKillAfter: "1500 millis",
    });

    const childPid = Number(child.pid);
    const signalHandlers: Array<readonly [NodeJS.Signals, () => void]> = [];
    const registerSignalHandler = (
      signal: NodeJS.Signals,
      options?: {
        readonly childSignal?: NodeJS.Signals | undefined;
        readonly exitCode?: number | undefined;
      },
    ): void => {
      const handler = () => {
        terminateProcessTree(childPid, options?.childSignal ?? signal);

        setTimeout(() => {
          terminateProcessTree(childPid, "SIGKILL");
        }, 1_500).unref();

        process.exit(options?.exitCode ?? signalExitCode(signal));
      };

      process.once(signal, handler);
      signalHandlers.push([signal, handler]);
    };

    registerSignalHandler("SIGINT");
    registerSignalHandler("SIGTERM");
    registerSignalHandler("SIGHUP");
    if (DESKTOP_DEV_SHUTDOWN_SIGNAL === "SIGUSR2") {
      // Internal clean-shutdown request sent by the dev Electron launcher when
      // the user closes the app window or quits the app.
      registerSignalHandler("SIGUSR2", {
        childSignal: "SIGTERM",
        exitCode: 0,
      });
    }

    try {
      const exitCode = yield* child.exitCode;
      if (exitCode !== 0) {
        return yield* new DevRunnerError({
          message: `${input.mode === "dev:server" ? "bun" : "turbo"} exited with code ${exitCode}`,
        });
      }
    } finally {
      for (const [signal, handler] of signalHandlers) {
        process.removeListener(signal, handler);
      }
    }
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof DevRunnerError
        ? cause
        : new DevRunnerError({
            message: cause instanceof Error ? cause.message : "dev-runner failed",
            cause,
          }),
    ),
  );
}

const devRunnerCli = Command.make("dev-runner", {
  mode: Argument.choice("mode", DEV_RUNNER_MODES).pipe(
    Argument.withDescription("Development mode to run."),
  ),
  t3Home: Flag.string("home-dir").pipe(
    Flag.withDescription("Base directory for all Kodo Code data (equivalent to KODOCODE_HOME)."),
    Flag.withFallbackConfig(optionalStringConfig("KODOCODE_HOME")),
  ),
  authToken: Flag.string("auth-token").pipe(
    Flag.withDescription("Auth token (forwards to T3CODE_AUTH_TOKEN)."),
    Flag.withAlias("token"),
    Flag.withFallbackConfig(optionalStringConfig("T3CODE_AUTH_TOKEN")),
  ),
  noBrowser: Flag.boolean("no-browser").pipe(
    Flag.withDescription("Browser auto-open toggle (equivalent to T3CODE_NO_BROWSER)."),
    Flag.withFallbackConfig(optionalBooleanConfig("T3CODE_NO_BROWSER")),
  ),
  autoBootstrapProjectFromCwd: Flag.boolean("auto-bootstrap-project-from-cwd").pipe(
    Flag.withDescription(
      "Auto-bootstrap toggle (equivalent to T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD).",
    ),
    Flag.withFallbackConfig(optionalBooleanConfig("T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD")),
  ),
  logWebSocketEvents: Flag.boolean("log-websocket-events").pipe(
    Flag.withDescription("WebSocket event logging toggle (equivalent to T3CODE_LOG_WS_EVENTS)."),
    Flag.withAlias("log-ws-events"),
    Flag.withFallbackConfig(optionalBooleanConfig("T3CODE_LOG_WS_EVENTS")),
  ),
  host: Flag.string("host").pipe(
    Flag.withDescription("Server host/interface override (forwards to T3CODE_HOST)."),
    Flag.withFallbackConfig(optionalStringConfig("T3CODE_HOST")),
  ),
  port: Flag.integer("port").pipe(
    Flag.withSchema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))),
    Flag.withDescription("Server port override (forwards to T3CODE_PORT)."),
    Flag.withFallbackConfig(optionalPortConfig("T3CODE_PORT")),
  ),
  devUrl: Flag.string("dev-url").pipe(
    Flag.withSchema(Schema.URLFromString),
    Flag.withDescription("Web dev URL override (forwards to VITE_DEV_SERVER_URL)."),
    Flag.withFallbackConfig(optionalUrlConfig("VITE_DEV_SERVER_URL")),
  ),
  dryRun: Flag.boolean("dry-run").pipe(
    Flag.withDescription("Resolve mode/ports/env and print, but do not spawn turbo."),
    Flag.withDefault(false),
  ),
  turboArgs: Argument.string("turbo-arg").pipe(
    Argument.withDescription("Additional turbo args (pass after `--`)."),
    Argument.variadic(),
  ),
}).pipe(
  Command.withDescription("Run monorepo development modes with deterministic port/env wiring."),
  Command.withHandler((input) => runDevRunnerWithInput(input)),
);

const cliRuntimeLayer = Layer.mergeAll(
  Logger.layer([Logger.consolePretty()]),
  NodeServices.layer,
  NetService.layer,
);

const runtimeProgram = Command.run(devRunnerCli, { version: "0.0.0" }).pipe(
  Effect.scoped,
  Effect.provide(cliRuntimeLayer),
);

if (import.meta.main) {
  NodeRuntime.runMain(runtimeProgram);
}
