import { describe, expect, it } from "vitest";
import { resolveChatReadabilityClassName } from "./chatReadability";

describe("resolveChatReadabilityClassName", () => {
  it("keeps auto typography free of script-specific font overrides", () => {
    const className = resolveChatReadabilityClassName({
      direction: "rtl",
      fontFamily: "auto",
      textSize: "default",
    });

    expect(className).toContain("chat-readability-surface");
    expect(className).toContain("chat-readability-direction-rtl");
    expect(className).toContain("chat-readability-text-default");
    expect(className).not.toContain("chat-readability-font-noto-sans-multiscript");
  });

  it("applies explicit font and size classes when selected", () => {
    const className = resolveChatReadabilityClassName({
      direction: "ltr",
      fontFamily: "noto-sans",
      textSize: "large",
    });

    expect(className).toContain("chat-readability-direction-ltr");
    expect(className).toContain("chat-readability-font-noto-sans");
    expect(className).toContain("chat-readability-text-large");
  });

  it("supports the bundled multiscript font stack", () => {
    const className = resolveChatReadabilityClassName({
      direction: "auto",
      fontFamily: "noto-sans-multiscript",
      textSize: "small",
    });

    expect(className).toContain("chat-readability-direction-auto");
    expect(className).toContain("chat-readability-font-noto-sans-multiscript");
    expect(className).toContain("chat-readability-text-small");
  });
});
