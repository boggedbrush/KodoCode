import * as Crypto from "node:crypto";

import { Effect, FileSystem, Layer, Path } from "effect";
import * as PlatformError from "effect/PlatformError";

import { ServerConfig } from "../../config.ts";
import {
  SecretStoreError,
  ServerSecretStore,
  type ServerSecretStoreShape,
} from "../Services/ServerSecretStore.ts";

export const makeServerSecretStore = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;

  yield* fileSystem.makeDirectory(serverConfig.secretsDir, { recursive: true });
  yield* fileSystem.chmod(serverConfig.secretsDir, 0o700).pipe(
    Effect.mapError(
      (cause) =>
        new SecretStoreError({
          message: `Failed to secure secrets directory ${serverConfig.secretsDir}.`,
          cause,
        }),
    ),
  );

  const resolveSecretPath = (name: string) => path.join(serverConfig.secretsDir, `${name}.bin`);

  const toSecretStoreError = (name: string, action: string) => (cause: unknown) =>
    new SecretStoreError({
      message: `Failed to ${action} secret ${name}.`,
      cause,
    });

  const isMissingSecretFileError = (cause: unknown): cause is PlatformError.PlatformError =>
    cause instanceof PlatformError.PlatformError && cause.reason._tag === "NotFound";

  const isAlreadyExistsSecretFileError = (cause: unknown): cause is PlatformError.PlatformError =>
    cause instanceof PlatformError.PlatformError && cause.reason._tag === "AlreadyExists";

  const writeSecretFile = (secretPath: string, value: Uint8Array) =>
    Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fileSystem.open(secretPath, {
          flag: "wx",
          mode: 0o600,
        });
        yield* file.writeAll(value);
        yield* file.sync;
        yield* fileSystem.chmod(secretPath, 0o600);
      }),
    );

  const cleanupTempSecretFile = (tempPath: string) =>
    fileSystem.remove(tempPath).pipe(
      Effect.catch((cause) => (isMissingSecretFileError(cause) ? Effect.void : Effect.fail(cause))),
      Effect.ignore,
    );

  const withTempSecretFile = <A, E>(
    secretPath: string,
    value: Uint8Array,
    use: (tempPath: string) => Effect.Effect<A, E>,
  ) => {
    const tempPath = `${secretPath}.${Crypto.randomUUID()}.tmp`;
    return writeSecretFile(tempPath, value).pipe(
      Effect.flatMap(() => use(tempPath)),
      Effect.catch((cause) =>
        cleanupTempSecretFile(tempPath).pipe(Effect.flatMap(() => Effect.fail(cause))),
      ),
    );
  };

  const get: ServerSecretStoreShape["get"] = (name) =>
    fileSystem.readFile(resolveSecretPath(name)).pipe(
      Effect.map((bytes) => Uint8Array.from(bytes)),
      Effect.catch((cause) =>
        isMissingSecretFileError(cause)
          ? Effect.succeed(null)
          : Effect.fail(toSecretStoreError(name, "read")(cause)),
      ),
    );

  const remove: ServerSecretStoreShape["remove"] = (name) =>
    fileSystem
      .remove(resolveSecretPath(name))
      .pipe(
        Effect.catch((cause) =>
          isMissingSecretFileError(cause)
            ? Effect.void
            : Effect.fail(toSecretStoreError(name, "remove")(cause)),
        ),
      );

  const set: ServerSecretStoreShape["set"] = (name, value) => {
    const secretPath = resolveSecretPath(name);
    return withTempSecretFile(secretPath, value, (tempPath) =>
      Effect.gen(function* () {
        yield* fileSystem.rename(tempPath, secretPath);
        yield* fileSystem.chmod(secretPath, 0o600);
      }),
    ).pipe(Effect.mapError(toSecretStoreError(name, "persist")));
  };

  const create: ServerSecretStoreShape["set"] = (name, value) => {
    const secretPath = resolveSecretPath(name);
    return withTempSecretFile(secretPath, value, (tempPath) =>
      Effect.gen(function* () {
        // Write into a temp inode first, then hard-link it into place. That keeps
        // the final secret path free of partially-written bytes if startup dies
        // mid-write, while `link()` still gives us create-once semantics when
        // multiple runtime layers race to initialize the same secret.
        yield* fileSystem.link(tempPath, secretPath);
        yield* cleanupTempSecretFile(tempPath);
      }),
    ).pipe(Effect.mapError(toSecretStoreError(name, "persist")));
  };

  const clearInvalidRandomSecret = (name: string, expectedBytes: number, actualBytes: number) =>
    remove(name).pipe(
      Effect.mapError(
        (cause) =>
          new SecretStoreError({
            message:
              `Failed to discard corrupt secret ${name}. ` +
              `Expected ${expectedBytes} bytes but found ${actualBytes}.`,
            cause,
          }),
      ),
      Effect.as(null),
    );

  const getValidRandomSecret = (name: string, bytes: number) =>
    get(name).pipe(
      Effect.flatMap((existing) => {
        if (existing === null) {
          return Effect.succeed(null);
        }
        if (existing.byteLength === bytes) {
          return Effect.succeed(existing);
        }

        // Treat wrong-sized secrets as corrupt so an interrupted first boot does
        // not leave auth permanently stuck behind a truncated signing key file.
        return clearInvalidRandomSecret(name, bytes, existing.byteLength);
      }),
    );

  const getOrCreateRandom: ServerSecretStoreShape["getOrCreateRandom"] = (name, bytes) =>
    getValidRandomSecret(name, bytes).pipe(
      Effect.flatMap((existing) => {
        if (existing !== null) {
          return Effect.succeed(existing);
        }

        const generated = Crypto.randomBytes(bytes);
        return create(name, generated).pipe(
          Effect.as(Uint8Array.from(generated)),
          Effect.catchTag("SecretStoreError", (error) =>
            isAlreadyExistsSecretFileError(error.cause)
              ? getValidRandomSecret(name, bytes).pipe(
                  Effect.flatMap((created) =>
                    created !== null
                      ? Effect.succeed(created)
                      : Effect.fail(
                          new SecretStoreError({
                            message: `Failed to read secret ${name} after concurrent creation.`,
                          }),
                        ),
                  ),
                )
              : Effect.fail(error),
          ),
        );
      }),
    );

  return {
    get,
    set,
    getOrCreateRandom,
    remove,
  } satisfies ServerSecretStoreShape;
});

export const ServerSecretStoreLive = Layer.effect(ServerSecretStore, makeServerSecretStore);
