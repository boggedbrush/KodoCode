import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { PUBLISH_BUILD_ASSET_PATHS, resolvePublishPackageJson } from "./cli.ts";

it.layer(NodeServices.layer)("server scripts cli", (it) => {
  it.effect(
    "resolvePublishPackageJson uses launcher bin entrypoint and resolves root overrides",
    () =>
      Effect.gen(function* () {
        assert.deepStrictEqual(PUBLISH_BUILD_ASSET_PATHS, [
          "dist/bin.mjs",
          "dist/client/index.html",
          "kodo",
        ]);

        const pkg = yield* resolvePublishPackageJson(Option.some("9.9.9"));

        assert.equal(pkg.name, "@boggedbrush/kodo");
        assert.equal(pkg.version, "9.9.9");
        assert.equal(pkg.bin.kodo, "kodo");
        assert.deepStrictEqual(pkg.files, ["dist", "kodo"]);
        assert.equal(pkg.dependencies.effect, "4.0.0-beta.43");
        assert.equal(pkg.overrides["@effect/platform-node-shared"], "4.0.0-beta.43");
        assert.equal(pkg.overrides.defu, "^6.1.5");
        assert.equal(pkg.overrides.picomatch, "^2.3.2");
        assert.equal(pkg.overrides["vitest>vite"], undefined);
      }),
  );
});
