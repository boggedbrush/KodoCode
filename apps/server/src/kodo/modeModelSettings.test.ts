import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderInstanceId, ServerSettings } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettingsModule from "../serverSettings.ts";

const layer = ServerSettingsModule.layer.pipe(
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ManagedPolicy.layerTest()),
  Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
  Layer.provideMerge(
    Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "kodo-mode-models-settings-" })),
  ),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(NodeCrypto.layer),
);

it.effect("saves one mode's model in the settings file and keeps the other slots on update", () =>
  Effect.gen(function* () {
    const service = yield* ServerSettingsModule.ServerSettingsService;
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const ask = createModelSelection(ProviderInstanceId.make("codex"), "gpt-ask");
    const plan = createModelSelection(ProviderInstanceId.make("claudeAgent"), "opus", [
      { id: "effort", value: "high" },
    ]);
    yield* service.updateSettings({ modeModelSelections: { ask } });
    const next = yield* service.updateSettings({ modeModelSelections: { plan, judge: ask } });
    assert.deepEqual(next.modeModelSelections.ask, ask);
    assert.deepEqual(next.modeModelSelections.plan, plan);
    assert.isNull(next.modeModelSelections.review);
    const saved = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ServerSettings))(
      yield* fs.readFileString(config.settingsPath),
    );
    assert.deepEqual(saved.modeModelSelections, next.modeModelSelections);
    const cleared = yield* service.updateSettings({ modeModelSelections: { ask: null } });
    assert.isNull(cleared.modeModelSelections.ask);
    assert.deepEqual(cleared.modeModelSelections.plan, plan);
  }).pipe(Effect.provide(layer)),
);
