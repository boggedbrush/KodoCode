import { describe, expect, it } from "vitest";

import { inferImageExtension, parseBase64DataUrl } from "./imageMime.ts";
import { getContentTypeFromFilePath } from "./mime.ts";

describe("imageMime", () => {
  it("parses base64 data URL with mime type", () => {
    expect(parseBase64DataUrl("data:image/png;base64,SGVsbG8=")).toEqual({
      mimeType: "image/png",
      base64: "SGVsbG8=",
    });
  });

  it("parses base64 data URL with mime parameters", () => {
    expect(parseBase64DataUrl("data:image/png;charset=utf-8;base64,SGVsbG8=")).toEqual({
      mimeType: "image/png",
      base64: "SGVsbG8=",
    });
  });

  it("rejects non-base64 data URL", () => {
    expect(parseBase64DataUrl("data:image/png;charset=utf-8,hello")).toBeNull();
  });

  it("rejects missing mime type", () => {
    expect(parseBase64DataUrl("data:;base64,SGVsbG8=")).toBeNull();
  });

  it("parses base64 data URL with spaces in payload", () => {
    expect(parseBase64DataUrl("data:image/png;base64,SGVs bG8=\n")).toEqual({
      mimeType: "image/png",
      base64: "SGVsbG8=",
    });
  });

  it("does not read inherited keys from mime extension map", () => {
    expect(inferImageExtension({ mimeType: "constructor" })).toBe(".bin");
  });

  it("returns a content type for common static assets", () => {
    expect(getContentTypeFromFilePath("/tmp/index.html")).toBe("text/html; charset=utf-8");
    expect(getContentTypeFromFilePath("/tmp/app.js")).toBe("text/javascript; charset=utf-8");
    expect(getContentTypeFromFilePath("/tmp/logo.svg")).toBe("image/svg+xml");
  });

  it("falls back to octet-stream for unknown extensions", () => {
    expect(getContentTypeFromFilePath("/tmp/archive.custom")).toBe("application/octet-stream");
  });
});
