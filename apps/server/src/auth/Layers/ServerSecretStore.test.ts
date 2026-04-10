import * as nodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";

import { ServerConfig } from "../../config.ts";
import { ServerSecretStore } from "../Services/ServerSecretStore.ts";
import { ServerSecretStoreLive } from "./ServerSecretStore.ts";

const makeSecretStoreLayer = (baseDir: string) => {
  const configLayer = ServerConfig.layerTest(process.cwd(), baseDir);
  return Layer.mergeAll(configLayer, ServerSecretStoreLive.pipe(Layer.provide(configLayer)));
};

it.layer(NodeServices.layer)("ServerSecretStoreLive", (it) => {
  it.effect("replaces truncated random secrets instead of reusing them", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-secret-store-truncated-",
      });

      const result = yield* Effect.gen(function* () {
        const config = yield* ServerConfig;
        const secretPath = nodePath.join(config.secretsDir, "server-signing-key.bin");
        yield* fileSystem.writeFile(secretPath, Uint8Array.from([1, 2, 3]));

        const secretStore = yield* ServerSecretStore;
        const secret = yield* secretStore.getOrCreateRandom("server-signing-key", 32);
        const persisted = Uint8Array.from(yield* fileSystem.readFile(secretPath));

        return { secret, persisted };
      }).pipe(Effect.provide(makeSecretStoreLayer(baseDir)));

      expect(result.secret.byteLength).toBe(32);
      expect(result.persisted.byteLength).toBe(32);
      expect(Array.from(result.persisted)).toEqual(Array.from(result.secret));
      expect(Array.from(result.persisted)).not.toEqual([1, 2, 3]);
    }),
  );
});
