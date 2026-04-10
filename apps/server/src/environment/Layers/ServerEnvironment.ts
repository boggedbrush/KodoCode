import { EnvironmentId, type ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Path, Random } from "effect";
import * as PlatformError from "effect/PlatformError";

import { ServerConfig } from "../../config.ts";
import { ServerEnvironment, type ServerEnvironmentShape } from "../Services/ServerEnvironment.ts";
import { version } from "../../../package.json" with { type: "json" };

function platformOs(): ExecutionEnvironmentDescriptor["platform"]["os"] {
  switch (process.platform) {
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      return "unknown";
  }
}

function platformArch(): ExecutionEnvironmentDescriptor["platform"]["arch"] {
  switch (process.arch) {
    case "arm64":
      return "arm64";
    case "x64":
      return "x64";
    default:
      return "other";
  }
}

export const makeServerEnvironment = Effect.fn("makeServerEnvironment")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;
  const isAlreadyExistsError = (cause: unknown): cause is PlatformError.PlatformError =>
    cause instanceof PlatformError.PlatformError && cause.reason._tag === "AlreadyExists";

  const readPersistedEnvironmentId = Effect.gen(function* () {
    const exists = yield* fileSystem
      .exists(serverConfig.environmentIdPath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return null;
    }

    const raw = yield* fileSystem
      .readFileString(serverConfig.environmentIdPath)
      .pipe(Effect.map((value) => value.trim()));

    return raw.length > 0 ? raw : null;
  });

  const persistEnvironmentId = (value: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fileSystem.open(serverConfig.environmentIdPath, {
          flag: "wx",
          mode: 0o600,
        });
        yield* file.writeAll(Buffer.from(`${value}\n`, "utf8"));
        yield* file.sync;
      }),
    );

  const environmentIdRaw = yield* Effect.gen(function* () {
    const persisted = yield* readPersistedEnvironmentId;
    if (persisted) {
      return persisted;
    }

    const generated = yield* Random.nextUUIDv4;
    const persistedOrGenerated = yield* persistEnvironmentId(generated).pipe(
      // Multiple runtime sublayers can ask for the environment descriptor during startup.
      // Using an exclusive create keeps all of them pinned to one persisted id instead of
      // racing to create different cookie names or environment descriptors on first boot.
      Effect.as(generated),
      Effect.catch((cause) =>
        isAlreadyExistsError(cause)
          ? readPersistedEnvironmentId.pipe(
              Effect.flatMap((concurrentValue) =>
                concurrentValue !== null ? Effect.succeed(concurrentValue) : Effect.fail(cause),
              ),
            )
          : Effect.fail(cause),
      ),
    );
    return persistedOrGenerated;
  });

  const environmentId = EnvironmentId.makeUnsafe(environmentIdRaw);
  const cwdBaseName = path.basename(serverConfig.cwd).trim();
  const label =
    serverConfig.mode === "desktop"
      ? "Local environment"
      : cwdBaseName.length > 0
        ? cwdBaseName
        : "Kodo environment";

  const descriptor: ExecutionEnvironmentDescriptor = {
    environmentId,
    label,
    platform: {
      os: platformOs(),
      arch: platformArch(),
    },
    serverVersion: version,
    capabilities: {
      repositoryIdentity: true,
    },
  };

  return {
    getEnvironmentId: Effect.succeed(environmentId),
    getDescriptor: Effect.succeed(descriptor),
  } satisfies ServerEnvironmentShape;
});

export const ServerEnvironmentLive = Layer.effect(ServerEnvironment, makeServerEnvironment());
