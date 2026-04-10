/**
 * ServerConfig - Runtime configuration services.
 *
 * Defines process-level server configuration and networking helpers used by
 * startup and runtime layers.
 *
 * @module ServerConfig
 */
import { Effect, FileSystem, Layer, LogLevel, Path, Schema, ServiceMap } from "effect";

export const DEFAULT_PORT = 3773;

export const RuntimeMode = Schema.Literals(["web", "desktop"]);
export type RuntimeMode = typeof RuntimeMode.Type;

/**
 * ServerDerivedPaths - Derived paths from the base directory.
 */
export interface ServerDerivedPaths {
  readonly stateDir: string;
  readonly dbPath: string;
  readonly authStateDir: string;
  readonly authDbPath: string;
  readonly keybindingsConfigPath: string;
  readonly settingsPath: string;
  readonly worktreesDir: string;
  readonly attachmentsDir: string;
  readonly logsDir: string;
  readonly serverLogPath: string;
  readonly serverTracePath: string;
  readonly providerLogsDir: string;
  readonly providerEventLogPath: string;
  readonly terminalLogsDir: string;
  readonly anonymousIdPath: string;
  readonly environmentIdPath: string;
  readonly secretsDir: string;
}

/**
 * ServerConfigShape - Process/runtime configuration required by the server.
 */
export interface ServerConfigShape extends ServerDerivedPaths {
  readonly logLevel: LogLevel.LogLevel;
  readonly traceMinLevel: LogLevel.LogLevel;
  readonly traceTimingEnabled: boolean;
  readonly traceBatchWindowMs: number;
  readonly traceMaxBytes: number;
  readonly traceMaxFiles: number;
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
  readonly otlpExportIntervalMs: number;
  readonly otlpServiceName: string;
  readonly mode: RuntimeMode;
  readonly port: number;
  readonly host: string | undefined;
  readonly cwd: string;
  readonly baseDir: string;
  readonly staticDir: string | undefined;
  readonly devUrl: URL | undefined;
  readonly noBrowser: boolean;
  readonly authToken: string | undefined;
  readonly autoBootstrapProjectFromCwd: boolean;
  readonly logWebSocketEvents: boolean;
}

export interface ServerAuthStateScope {
  readonly mode: RuntimeMode;
  readonly host: string | undefined;
}

const LOOPBACK_AUTH_STATE_SCOPE_KEY = "loopback";

const sanitizeAuthStateScopeSegment = (value: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  return normalized.replace(/^-+|-+$/g, "") || "default";
};

function normalizeAuthStateScopeHost(host: string | undefined): string {
  const normalizedHost = host?.trim().toLowerCase();
  if (!normalizedHost) {
    return LOOPBACK_AUTH_STATE_SCOPE_KEY;
  }

  if (
    normalizedHost === "localhost" ||
    normalizedHost === "127.0.0.1" ||
    normalizedHost === "::1" ||
    normalizedHost === "[::1]"
  ) {
    // These are all equivalent local-only launch modes for the standalone server, so
    // they need to share one persisted auth identity and cookie namespace.
    return LOOPBACK_AUTH_STATE_SCOPE_KEY;
  }

  return normalizedHost;
}

const deriveAuthStateScopeKey = (scope: ServerAuthStateScope) =>
  [
    sanitizeAuthStateScopeSegment(scope.mode),
    sanitizeAuthStateScopeSegment(normalizeAuthStateScopeHost(scope.host)),
  ].join("-");

export const deriveServerPaths = Effect.fn(function* (
  baseDir: ServerConfigShape["baseDir"],
  devUrl: ServerConfigShape["devUrl"],
  authStateScope: ServerAuthStateScope = {
    mode: "web",
    host: undefined,
  },
): Effect.fn.Return<ServerDerivedPaths, never, Path.Path> {
  const { join } = yield* Path.Path;
  const stateDir = join(baseDir, devUrl !== undefined ? "dev" : "userdata");
  const dbPath = join(stateDir, "state.sqlite");
  // Keep the main runtime database stable, but scope auth artifacts to the
  // stable server identity. The bound port is intentionally excluded here
  // because desktop/web can rebind to the next free port on restart, and
  // auth/session history must survive that transport-level move.
  const authStateDir = join(stateDir, "auth", deriveAuthStateScopeKey(authStateScope));
  const authDbPath = join(authStateDir, "state.sqlite");
  const attachmentsDir = join(stateDir, "attachments");
  const logsDir = join(stateDir, "logs");
  const providerLogsDir = join(logsDir, "provider");
  return {
    stateDir,
    dbPath,
    authStateDir,
    authDbPath,
    keybindingsConfigPath: join(stateDir, "keybindings.json"),
    settingsPath: join(stateDir, "settings.json"),
    worktreesDir: join(baseDir, "worktrees"),
    attachmentsDir,
    logsDir,
    serverLogPath: join(logsDir, "server.log"),
    serverTracePath: join(logsDir, "server.trace.ndjson"),
    providerLogsDir,
    providerEventLogPath: join(providerLogsDir, "events.log"),
    terminalLogsDir: join(logsDir, "terminals"),
    anonymousIdPath: join(stateDir, "anonymous-id"),
    environmentIdPath: join(authStateDir, "environment-id"),
    secretsDir: join(authStateDir, "secrets"),
  };
});

export const ensureServerDirectories = Effect.fn(function* (derivedPaths: ServerDerivedPaths) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  yield* Effect.all(
    [
      fs.makeDirectory(derivedPaths.stateDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.logsDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.providerLogsDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.terminalLogsDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.attachmentsDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.authStateDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.worktreesDir, { recursive: true }),
      fs.makeDirectory(path.dirname(derivedPaths.keybindingsConfigPath), { recursive: true }),
      fs.makeDirectory(path.dirname(derivedPaths.settingsPath), { recursive: true }),
      fs.makeDirectory(path.dirname(derivedPaths.anonymousIdPath), { recursive: true }),
      fs.makeDirectory(path.dirname(derivedPaths.environmentIdPath), { recursive: true }),
      fs.makeDirectory(derivedPaths.secretsDir, { recursive: true }),
    ],
    { concurrency: "unbounded" },
  );
});

/**
 * ServerConfig - Service tag for server runtime configuration.
 */
export class ServerConfig extends ServiceMap.Service<ServerConfig, ServerConfigShape>()(
  "t3/config/ServerConfig",
) {
  static readonly layerTest = (cwd: string, baseDirOrPrefix: string | { prefix: string }) =>
    Layer.effect(
      ServerConfig,
      Effect.gen(function* () {
        const devUrl = undefined;

        const fs = yield* FileSystem.FileSystem;
        const baseDir =
          typeof baseDirOrPrefix === "string"
            ? baseDirOrPrefix
            : yield* fs.makeTempDirectoryScoped({ prefix: baseDirOrPrefix.prefix });
        const derivedPaths = yield* deriveServerPaths(baseDir, devUrl, {
          mode: "web",
          host: undefined,
        });
        yield* ensureServerDirectories(derivedPaths);

        return {
          logLevel: "Error",
          traceMinLevel: "Info",
          traceTimingEnabled: true,
          traceBatchWindowMs: 200,
          traceMaxBytes: 10 * 1024 * 1024,
          traceMaxFiles: 10,
          otlpTracesUrl: undefined,
          otlpMetricsUrl: undefined,
          otlpExportIntervalMs: 10_000,
          otlpServiceName: "kodo-server",
          cwd,
          baseDir,
          ...derivedPaths,
          mode: "web",
          autoBootstrapProjectFromCwd: false,
          logWebSocketEvents: false,
          port: 0,
          host: undefined,
          authToken: undefined,
          staticDir: undefined,
          devUrl,
          noBrowser: false,
        } satisfies ServerConfigShape;
      }),
    );
}

export const resolveStaticDir = Effect.fn(function* () {
  const { join, resolve } = yield* Path.Path;
  const { exists } = yield* FileSystem.FileSystem;
  const bundledClient = resolve(join(import.meta.dirname, "client"));
  const bundledStat = yield* exists(join(bundledClient, "index.html")).pipe(
    Effect.orElseSucceed(() => false),
  );
  if (bundledStat) {
    return bundledClient;
  }

  const monorepoClient = resolve(join(import.meta.dirname, "../../web/dist"));
  const monorepoStat = yield* exists(join(monorepoClient, "index.html")).pipe(
    Effect.orElseSucceed(() => false),
  );
  if (monorepoStat) {
    return monorepoClient;
  }
  return undefined;
});
