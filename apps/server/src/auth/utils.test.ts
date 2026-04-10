import { describe, expect, it } from "vitest";

import { deriveAuthClientMetadata, deriveSessionCookieName } from "./utils";

describe("deriveSessionCookieName", () => {
  it("returns a stable, environment-scoped cookie name", () => {
    expect(deriveSessionCookieName("env-local")).toBe(deriveSessionCookieName("env-local"));
    expect(deriveSessionCookieName("env-local")).not.toBe(deriveSessionCookieName("env-remote"));
    expect(deriveSessionCookieName("env-local")).toMatch(/^kodo_session_[a-f0-9]{12}$/);
  });
});

describe("deriveAuthClientMetadata", () => {
  it("labels Electron user agents as Electron instead of Chrome", () => {
    const metadata = deriveAuthClientMetadata({
      request: {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) t3code/0.0.15 Chrome/136.0.7103.93 Electron/36.3.2 Safari/537.36",
        },
        source: {
          remoteAddress: "::ffff:127.0.0.1",
        },
      } as never,
    });

    expect(metadata).toMatchObject({
      browser: "Electron",
      deviceType: "desktop",
      ipAddress: "127.0.0.1",
      os: "macOS",
    });
  });
});
