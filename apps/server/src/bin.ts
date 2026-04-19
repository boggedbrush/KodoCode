import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/unstable/cli";

import { NetService } from "@t3tools/shared/Net";
import { cli } from "./cli";
import { version } from "../package.json" with { type: "json" };

const isBunRuntime = typeof Bun !== "undefined";

const main = (Command.run(cli, { version }) as any).pipe(Effect.scoped);

if (isBunRuntime) {
  const BunRuntime = await import("@effect/platform-bun/BunRuntime");
  const BunServices = await import("@effect/platform-bun/BunServices");
  const cliRuntimeLayer = Layer.mergeAll(BunServices.layer, NetService.layer);

  BunRuntime.runMain(main.pipe(Effect.provide(cliRuntimeLayer)));
} else {
  const NodeRuntime = await import("@effect/platform-node/NodeRuntime");
  const NodeServices = await import("@effect/platform-node/NodeServices");
  const cliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);

  NodeRuntime.runMain(main.pipe(Effect.provide(cliRuntimeLayer)));
}
