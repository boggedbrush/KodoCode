import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { deriveServerPaths } from "./config.ts";

it.layer(NodeServices.layer)("deriveServerPaths", (it) => {
  it.effect("keeps auth storage stable across port changes while still separating hosts", () =>
    Effect.gen(function* () {
      const first = yield* deriveServerPaths("/tmp/t3-config-auth-scope", undefined, {
        mode: "web",
        host: "127.0.0.1",
      });
      const second = yield* deriveServerPaths("/tmp/t3-config-auth-scope", undefined, {
        mode: "web",
        host: "127.0.0.1",
      });
      const differentHost = yield* deriveServerPaths("/tmp/t3-config-auth-scope", undefined, {
        mode: "web",
        host: "0.0.0.0",
      });

      expect(first.stateDir).toBe(second.stateDir);
      expect(first.dbPath).toBe(second.dbPath);
      expect(first.authStateDir).toBe(second.authStateDir);
      expect(first.authDbPath).toBe(second.authDbPath);
      expect(first.environmentIdPath).toBe(second.environmentIdPath);
      expect(first.secretsDir).toBe(second.secretsDir);
      expect(first.authStateDir).not.toBe(differentHost.authStateDir);
    }),
  );
});
