import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { deriveServerPaths } from "./config.ts";

it.layer(NodeServices.layer)("deriveServerPaths", (it) => {
  it.effect(
    "shares auth storage across equivalent loopback hosts while separating remote hosts",
    () =>
      Effect.gen(function* () {
        const first = yield* deriveServerPaths("/tmp/t3-config-auth-scope", undefined, {
          mode: "web",
          host: undefined,
        });
        const localhost = yield* deriveServerPaths("/tmp/t3-config-auth-scope", undefined, {
          mode: "web",
          host: "localhost",
        });
        const loopbackIpv4 = yield* deriveServerPaths("/tmp/t3-config-auth-scope", undefined, {
          mode: "web",
          host: "127.0.0.1",
        });
        const loopbackIpv6 = yield* deriveServerPaths("/tmp/t3-config-auth-scope", undefined, {
          mode: "web",
          host: "::1",
        });
        const differentHost = yield* deriveServerPaths("/tmp/t3-config-auth-scope", undefined, {
          mode: "web",
          host: "0.0.0.0",
        });

        expect(first.stateDir).toBe(localhost.stateDir);
        expect(first.dbPath).toBe(localhost.dbPath);
        expect(first.authStateDir).toBe(localhost.authStateDir);
        expect(first.authDbPath).toBe(localhost.authDbPath);
        expect(first.environmentIdPath).toBe(localhost.environmentIdPath);
        expect(first.secretsDir).toBe(localhost.secretsDir);
        expect(first.authStateDir).toBe(loopbackIpv4.authStateDir);
        expect(first.authStateDir).toBe(loopbackIpv6.authStateDir);
        expect(first.authStateDir).not.toBe(differentHost.authStateDir);
      }),
  );
});
