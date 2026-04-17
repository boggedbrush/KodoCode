import { describe, expect, it, vi } from "vitest";

import { isIgnorableStdIoWriteError, patchStdIoWrite, type StdIoWrite } from "./stdioCapture";

describe("isIgnorableStdIoWriteError", () => {
  it("recognizes broken pipe writes", () => {
    const error = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    expect(isIgnorableStdIoWriteError(error)).toBe(true);
  });

  it("recognizes destroyed stream writes", () => {
    const error = Object.assign(new Error("stream destroyed"), { code: "ERR_STREAM_DESTROYED" });
    expect(isIgnorableStdIoWriteError(error)).toBe(true);
  });

  it("leaves other errors alone", () => {
    const error = Object.assign(new Error("boom"), { code: "ENOENT" });
    expect(isIgnorableStdIoWriteError(error)).toBe(false);
  });
});

describe("patchStdIoWrite", () => {
  it("captures chunks and stops forwarding after a broken pipe", () => {
    const onChunkCaptured = vi.fn();
    const originalWrite = vi.fn(() => {
      throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    }) as unknown as StdIoWrite;
    const onPassthroughDisabled = vi.fn();
    const patched = patchStdIoWrite({
      originalWrite,
      onChunkCaptured,
      onPassthroughDisabled,
    });

    expect(patched.write("first line\n")).toBe(true);
    expect(patched.isPassthroughEnabled()).toBe(false);
    expect(onPassthroughDisabled).toHaveBeenCalledTimes(1);

    expect(patched.write("second line\n")).toBe(true);

    expect(onChunkCaptured).toHaveBeenCalledTimes(2);
    expect(originalWrite).toHaveBeenCalledTimes(1);
  });

  it("converts ignorable callback errors into successful writes", () => {
    const callback = vi.fn();
    const originalWrite = vi.fn((chunk, encodingOrCallback, callbackArg) => {
      const forwardedCallback =
        typeof encodingOrCallback === "function" ? encodingOrCallback : callbackArg;
      forwardedCallback?.(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
      return true;
    }) as unknown as StdIoWrite;
    const patched = patchStdIoWrite({
      originalWrite,
      onChunkCaptured: vi.fn(),
    });

    expect(patched.write("line\n", callback)).toBe(true);
    expect(callback).toHaveBeenCalledWith(null);
    expect(patched.isPassthroughEnabled()).toBe(false);
  });

  it("lets non-ignorable stream errors bubble up to the caller", () => {
    const error = Object.assign(new Error("permission denied"), { code: "EPERM" });
    const originalWrite = vi.fn(() => {
      throw error;
    }) as unknown as StdIoWrite;
    const patched = patchStdIoWrite({
      originalWrite,
      onChunkCaptured: vi.fn(),
    });

    expect(() => patched.write("line\n")).toThrow(error);
    expect(patched.isPassthroughEnabled()).toBe(true);
  });

  it("handles broken pipe error events without crashing passthrough", () => {
    const patched = patchStdIoWrite({
      originalWrite: vi.fn(() => true) as unknown as StdIoWrite,
      onChunkCaptured: vi.fn(),
    });

    const handled = patched.handleStreamError(
      Object.assign(new Error("write EPIPE"), { code: "EPIPE" }),
    );

    expect(handled).toBe(true);
    expect(patched.isPassthroughEnabled()).toBe(false);
  });
});
