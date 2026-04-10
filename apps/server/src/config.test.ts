import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { deriveServerPaths } from "./config.ts";

it.layer(NodeServices.layer)("deriveServerPaths", (it) => {
  it.effect("scopes auth storage to each standalone server identity", () =>
    Effect.gen(function* () {
      const first = yield* deriveServerPaths("/tmp/t3-config-auth-scope", undefined, {
        mode: "web",
        host: "127.0.0.1",
        port: 3773,
      });
      const second = yield* deriveServerPaths("/tmp/t3-config-auth-scope", undefined, {
        mode: "web",
        host: "127.0.0.1",
        port: 3774,
      });

      expect(first.stateDir).toBe(second.stateDir);
      expect(first.dbPath).toBe(second.dbPath);
      expect(first.authStateDir).not.toBe(second.authStateDir);
      expect(first.authDbPath).not.toBe(second.authDbPath);
      expect(first.environmentIdPath).not.toBe(second.environmentIdPath);
      expect(first.secretsDir).not.toBe(second.secretsDir);
    }),
  );
});
