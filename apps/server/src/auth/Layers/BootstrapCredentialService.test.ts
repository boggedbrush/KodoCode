import { DateTime, Duration, Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import { ServerConfig, type ServerConfigShape } from "../../config.ts";
import {
  AuthPairingLinkRepository,
  type AuthPairingLinkRepositoryShape,
} from "../../persistence/Services/AuthPairingLinks.ts";
import { makeBootstrapCredentialService } from "./BootstrapCredentialService.ts";

const baseServerConfig = {
  stateDir: "/tmp/kodo-test/userdata",
  dbPath: "/tmp/kodo-test/userdata/state.sqlite",
  authStateDir: "/tmp/kodo-test/userdata/auth/web-loopback",
  authDbPath: "/tmp/kodo-test/userdata/auth/web-loopback/state.sqlite",
  keybindingsConfigPath: "/tmp/kodo-test/userdata/keybindings.json",
  settingsPath: "/tmp/kodo-test/userdata/settings.json",
  worktreesDir: "/tmp/kodo-test/worktrees",
  attachmentsDir: "/tmp/kodo-test/userdata/attachments",
  logsDir: "/tmp/kodo-test/userdata/logs",
  serverLogPath: "/tmp/kodo-test/userdata/logs/server.log",
  serverTracePath: "/tmp/kodo-test/userdata/logs/server.trace.ndjson",
  providerLogsDir: "/tmp/kodo-test/userdata/logs/provider",
  providerEventLogPath: "/tmp/kodo-test/userdata/logs/provider/events.log",
  terminalLogsDir: "/tmp/kodo-test/userdata/logs/terminals",
  anonymousIdPath: "/tmp/kodo-test/userdata/anonymous-id",
  environmentIdPath: "/tmp/kodo-test/userdata/auth/web-loopback/environment-id",
  secretsDir: "/tmp/kodo-test/userdata/auth/web-loopback/secrets",
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
  mode: "web",
  port: 3773,
  host: undefined,
  cwd: "/repo/project",
  baseDir: "/tmp/kodo-test",
  staticDir: undefined,
  devUrl: undefined,
  noBrowser: false,
  authToken: undefined,
  autoBootstrapProjectFromCwd: false,
  logWebSocketEvents: false,
} satisfies ServerConfigShape;

function makeBootstrapCredentialServiceTestLayer(options?: {
  readonly authPairingLinkRepository?: Partial<AuthPairingLinkRepositoryShape>;
  readonly serverConfig?: Partial<ServerConfigShape>;
}) {
  return Layer.mergeAll(
    Layer.succeed(ServerConfig, {
      ...baseServerConfig,
      ...options?.serverConfig,
    }),
    Layer.mock(AuthPairingLinkRepository)({
      create: () => Effect.void,
      consumeAvailable: () => Effect.succeed(Option.none()),
      listActive: () => Effect.succeed([]),
      revoke: () => Effect.succeed(false),
      getByCredential: () => Effect.succeed(Option.none()),
      ...options?.authPairingLinkRepository,
    }),
  );
}

describe("makeBootstrapCredentialService", () => {
  it("keeps configured auth tokens reusable after the pairing-link TTL window", async () => {
    await expect(
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const service = yield* makeBootstrapCredentialService;

            yield* TestClock.adjust(Duration.minutes(10));

            const first = yield* service.consume("shared-secret-token");
            const second = yield* service.consume("shared-secret-token");

            expect(first).toMatchObject({
              method: "desktop-bootstrap",
              role: "owner",
              subject: "desktop-bootstrap",
            });
            expect(second).toMatchObject({
              method: "desktop-bootstrap",
              role: "owner",
              subject: "desktop-bootstrap",
            });
            expect(DateTime.isGreaterThan(second.expiresAt, first.expiresAt)).toBe(false);
          }).pipe(
            Effect.provide(
              Layer.merge(
                TestClock.layer(),
                makeBootstrapCredentialServiceTestLayer({
                  serverConfig: {
                    authToken: "shared-secret-token",
                  },
                }),
              ),
            ),
          ),
        ),
      ),
    ).resolves.toBeUndefined();
  });
});
