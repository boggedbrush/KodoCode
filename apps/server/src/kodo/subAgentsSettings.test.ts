// KODO: sub-agents-setting - the default and the live-worker cap decode, save and layer by project.
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  KODO_SUB_AGENTS_DEFAULT_MAX_WORKERS,
  ProjectId,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettingsModule from "../serverSettings.ts";

const decodeSettingsJson = Schema.decodeEffect(Schema.fromJsonString(ServerSettings));
const decodeSettings = Schema.decodeUnknownSync(ServerSettings);

const layer = ServerSettingsModule.layer.pipe(
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ManagedPolicy.layerTest()),
  Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
  Layer.provideMerge(
    Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "kodo-sub-agents-settings-" })),
  ),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(NodeCrypto.layer),
);

it.effect(
  "the sub-agents settings start off and at three workers, save through a patch, and layer by project",
  () =>
    Effect.gen(function* () {
      const service = yield* ServerSettingsModule.ServerSettingsService;
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const initial = yield* service.getSettings;
      assert.isFalse(initial.kodoSubAgentsDefault);
      assert.equal(initial.kodoSubAgentsMaxWorkers, KODO_SUB_AGENTS_DEFAULT_MAX_WORKERS);

      const next = yield* service.updateSettings({
        kodoSubAgentsDefault: true,
        kodoSubAgentsMaxWorkers: 5,
      });
      assert.isTrue(next.kodoSubAgentsDefault);
      assert.equal(next.kodoSubAgentsMaxWorkers, 5);
      const saved = yield* decodeSettingsJson(yield* fs.readFileString(config.settingsPath));
      assert.isTrue(saved.kodoSubAgentsDefault);
      assert.equal(saved.kodoSubAgentsMaxWorkers, 5);

      // A project's own value wins over the environment's, and another project keeps the environment's.
      const project = ProjectId.make("project:sub-agents");
      const layered = yield* service.updateSettings({
        projectSettingsOverrides: { [project]: { kodoSubAgentsDefault: false } },
      });
      assert.isFalse(resolveProjectSettings(layered, project).settings.kodoSubAgentsDefault);
      assert.isTrue(
        resolveProjectSettings(layered, ProjectId.make("project:other")).settings
          .kodoSubAgentsDefault,
      );
      assert.equal(
        resolveProjectSettings(layered, project).sources.kodoSubAgentsDefault,
        "project",
      );
    }).pipe(Effect.provide(layer)),
);

it("a hand-edited cap or a stored kind this build does not know never fails the settings file", () => {
  const settings = decodeSettings({ kodoSubAgentsMaxWorkers: 99 });
  assert.equal(settings.kodoSubAgentsMaxWorkers, 99);
  assert.isFalse(decodeSettings({}).kodoSubAgentsDefault);
});

it("a patch for the live-worker cap outside 1 to 6 whole workers is refused", () => {
  const decodePatch = Schema.decodeUnknownExit(ServerSettingsPatch);
  for (const bad of [0, 7, 2.5]) {
    assert.isTrue(Exit.isFailure(decodePatch({ kodoSubAgentsMaxWorkers: bad })), String(bad));
  }
  for (const good of [1, 3, 6]) {
    assert.isTrue(Exit.isSuccess(decodePatch({ kodoSubAgentsMaxWorkers: good })), String(good));
  }
});
