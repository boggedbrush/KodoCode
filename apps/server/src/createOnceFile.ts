import * as Crypto from "node:crypto";

import { Effect, type FileSystem } from "effect";
import * as PlatformError from "effect/PlatformError";

const writeExclusiveFile = (
  fileSystem: FileSystem.FileSystem,
  filePath: string,
  value: Uint8Array,
  mode: number,
): Effect.Effect<void, PlatformError.PlatformError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const file = yield* fileSystem.open(filePath, {
        flag: "wx",
        mode,
      });
      yield* file.writeAll(value);
      yield* file.sync;
    }),
  );

export const createFileOnce = (options: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: string;
  readonly value: Uint8Array;
  readonly mode?: number;
}): Effect.Effect<void, PlatformError.PlatformError> => {
  const tempPath = `${options.path}.${Crypto.randomUUID()}.tmp`;
  const mode = options.mode ?? 0o600;

  return writeExclusiveFile(options.fileSystem, tempPath, options.value, mode).pipe(
    Effect.flatMap(() => {
      // Link the fully-written temp inode into place so crashes never leave the
      // final path visible with truncated bytes, while `link()` still preserves
      // create-once semantics when multiple startup layers race to initialize it.
      return options.fileSystem.link(tempPath, options.path);
    }),
    Effect.ensuring(
      options.fileSystem.remove(tempPath, { force: true }).pipe(Effect.ignore({ log: true })),
    ),
  );
};
