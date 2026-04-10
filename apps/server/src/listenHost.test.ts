import { describe, expect, it } from "vitest";

import { resolveServerListenHost } from "./listenHost";

describe("resolveServerListenHost", () => {
  it("defaults an unspecified host to loopback", () => {
    expect(resolveServerListenHost(undefined)).toBe("127.0.0.1");
    expect(resolveServerListenHost("")).toBe("127.0.0.1");
    expect(resolveServerListenHost("   ")).toBe("127.0.0.1");
  });

  it("preserves explicit listen hosts for remote-reachable deployments", () => {
    expect(resolveServerListenHost("0.0.0.0")).toBe("0.0.0.0");
    expect(resolveServerListenHost("::")).toBe("::");
    expect(resolveServerListenHost("100.64.0.10")).toBe("100.64.0.10");
  });
});
