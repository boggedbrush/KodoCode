import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/unstable/cli";

import { NetService } from "@t3tools/shared/Net";
import { cli } from "./cli";
import { version } from "../package.json" with { type: "json" };

const isBunRuntime = typeof Bun !== "undefined";

const main = (Command.run(cli, { version }) as any).pipe(Effect.scoped);

async function bootCli(): Promise<void> {
  // Keep runtime selection dynamic so the same source can boot under Bun for
  // local development and Node for packaged builds, without forcing the CJS
  // build to support top-level await.
  if (isBunRuntime) {
    const [BunRuntime, BunServices] = await Promise.all([
      import("@effect/platform-bun/BunRuntime"),
      import("@effect/platform-bun/BunServices"),
    ]);
    const cliRuntimeLayer = Layer.mergeAll(BunServices.layer, NetService.layer);

    BunRuntime.runMain(main.pipe(Effect.provide(cliRuntimeLayer)));
    return;
  }

  const [NodeRuntime, NodeServices] = await Promise.all([
    import("@effect/platform-node/NodeRuntime"),
    import("@effect/platform-node/NodeServices"),
  ]);
  const cliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);

  NodeRuntime.runMain(main.pipe(Effect.provide(cliRuntimeLayer)));
}

void bootCli();
