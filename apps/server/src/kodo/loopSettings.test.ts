import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { DEFAULT_KODO_LOOP_SETTINGS, ServerSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettingsModule from "../serverSettings.ts";

const decodeSettingsJson = Schema.decodeEffect(Schema.fromJsonString(ServerSettings));

const layer = ServerSettingsModule.layer.pipe(
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ManagedPolicy.layerTest()),
  Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
  Layer.provideMerge(
    Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "kodo-loop-settings-" })),
  ),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(NodeCrypto.layer),
);

it.effect(
  "a loop settings patch changes only what it names, saves, and clears a cap with null",
  () =>
    Effect.gen(function* () {
      const service = yield* ServerSettingsModule.ServerSettingsService;
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      assert.deepEqual((yield* service.getSettings).loop, DEFAULT_KODO_LOOP_SETTINGS);
      yield* service.updateSettings({ loop: { defaultMaxRounds: 5, budget: { maxCostUsd: 2 } } });
      const next = yield* service.updateSettings({
        loop: { planApproval: "ask", budget: { stopAtLimitPercent: 70 } },
      });
      assert.deepEqual(next.loop, {
        defaultMaxRounds: 5,
        planApproval: "ask",
        budget: { stopAtLimitPercent: 70, maxCostUsd: 2, maxTokens: null },
      });
      const saved = yield* decodeSettingsJson(yield* fs.readFileString(config.settingsPath));
      assert.deepEqual(saved.loop, next.loop);
      const cleared = yield* service.updateSettings({ loop: { budget: { maxCostUsd: null } } });
      assert.isNull(cleared.loop.budget.maxCostUsd);
      assert.equal(cleared.loop.defaultMaxRounds, 5);
    }).pipe(Effect.provide(layer)),
);
