import { describe, expect, it } from "vitest";

import { isRtlText, resolveTextDirection } from "./textDirection";

describe("resolveTextDirection", () => {
  it("detects Arabic text as rtl", () => {
    expect(resolveTextDirection("مرحبا بك في كودو")).toBe("rtl");
    expect(isRtlText("تحليل المشروع")).toBe(true);
  });

  it("detects Hebrew text as rtl without assuming Arabic", () => {
    expect(resolveTextDirection("שלום עולם")).toBe("rtl");
    expect(isRtlText("בדיקת ממשק")).toBe(true);
  });

  it("treats Latin text as ltr", () => {
    expect(resolveTextDirection("Review the latest diff")).toBe("ltr");
    expect(isRtlText("Run tests")).toBe(false);
  });

  it("ignores leading punctuation before the first strong rtl character", () => {
    expect(resolveTextDirection('... "مرحبا"')).toBe("rtl");
  });

  it("falls back to auto when no strong directional characters exist", () => {
    expect(resolveTextDirection("1234 [] ()")).toBe("auto");
  });
});
