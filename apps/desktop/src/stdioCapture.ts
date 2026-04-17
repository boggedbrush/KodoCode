type StdIoWriteCallback = (error?: Error | null) => void;

export type StdIoWrite = (
  chunk: string | Uint8Array,
  encodingOrCallback?: BufferEncoding | StdIoWriteCallback,
  callback?: StdIoWriteCallback,
) => boolean;

type PatchStdIoWriteOptions = {
  readonly originalWrite: StdIoWrite;
  readonly onChunkCaptured: (
    chunk: string | Uint8Array,
    encoding: BufferEncoding | undefined,
  ) => void;
  readonly onPassthroughDisabled?: () => void;
};

type PatchStdIoWriteResult = {
  readonly write: StdIoWrite;
  readonly handleStreamError: (error: Error) => boolean;
  readonly isPassthroughEnabled: () => boolean;
};

export function isIgnorableStdIoWriteError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? error.code : undefined;
  return code === "EPIPE" || code === "ERR_STREAM_DESTROYED";
}

export function patchStdIoWrite(options: PatchStdIoWriteOptions): PatchStdIoWriteResult {
  let passthroughEnabled = true;

  const disablePassthrough = (): void => {
    if (!passthroughEnabled) return;
    passthroughEnabled = false;
    options.onPassthroughDisabled?.();
  };

  const normalizeForwardError = (error?: Error | null): Error | null => {
    if (!error) return null;
    if (isIgnorableStdIoWriteError(error)) {
      disablePassthrough();
      return null;
    }
    return error;
  };

  const wrapCallback = (callback: StdIoWriteCallback | undefined): StdIoWriteCallback | undefined =>
    callback
      ? (error?: Error | null) => {
          callback(normalizeForwardError(error));
        }
      : undefined;

  const write: StdIoWrite = (chunk, encodingOrCallback, callback) => {
    const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : undefined;
    const callbackFromSecondArg =
      typeof encodingOrCallback === "function" ? encodingOrCallback : undefined;
    const wrappedCallback = wrapCallback(callback ?? callbackFromSecondArg);

    options.onChunkCaptured(chunk, encoding);

    if (!passthroughEnabled) {
      wrappedCallback?.(null);
      return true;
    }

    try {
      if (callbackFromSecondArg) {
        return options.originalWrite(chunk, wrappedCallback);
      }
      if (callback !== undefined) {
        return options.originalWrite(chunk, encoding, wrappedCallback);
      }
      if (encoding !== undefined) {
        return options.originalWrite(chunk, encoding);
      }
      return options.originalWrite(chunk);
    } catch (error) {
      if (isIgnorableStdIoWriteError(error)) {
        disablePassthrough();
        wrappedCallback?.(null);
        return true;
      }
      throw error;
    }
  };

  return {
    write,
    handleStreamError: (error) => {
      if (!isIgnorableStdIoWriteError(error)) return false;
      disablePassthrough();
      return true;
    },
    isPassthroughEnabled: () => passthroughEnabled,
  };
}
