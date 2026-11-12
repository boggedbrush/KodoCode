import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { OrchestrationV2Run } from "./orchestrationV2.ts";
import { normalizeKodoInteractionMode, ThreadInteractionMode } from "./kodoInteractionMode.ts";

const decode = Schema.decodeUnknownSync(ThreadInteractionMode);
const encode = Schema.encodeSync(ThreadInteractionMode);

describe("thread interaction mode", () => {
  it.each([
    ["ask", "ask"],
    ["plan", "plan"],
    ["code", "code"],
    ["review", "review"],
    ["swarm", "code"],
    ["", "ask"],
    ["REVIEW", "ask"],
    ["auto", "ask"],
  ])("decodes %j as %s", (stored, expected) => {
    expect(decode(stored)).toBe(expected);
    expect(normalizeKodoInteractionMode(stored)).toBe(expected);
  });

  it("keeps a stored default intact so snapshots round-trip, and reads it as code", () => {
    expect(decode("default")).toBe("default");
    expect(encode(decode("default"))).toBe("default");
    expect(normalizeKodoInteractionMode("default")).toBe("code");
  });

  it("reads an absent value as code and a non-string as code, never failing", () => {
    expect(normalizeKodoInteractionMode(undefined)).toBe("code");
    expect(normalizeKodoInteractionMode(null)).toBe("code");
    expect(normalizeKodoInteractionMode(3)).toBe("code");
  });

  it("encodes a mode unchanged", () => {
    expect(encode("review")).toBe("review");
  });
});

// KODO: run-mode-snapshot - the field is optional, so runs, caches and peers without it still decode.
describe("run mode snapshot", () => {
  const runFields = Object.keys(OrchestrationV2Run.fields);
  it("is an optional run field", () => {
    expect(runFields).toContain("interactionMode");
    const field = OrchestrationV2Run.fields.interactionMode;
    const decodeField = Schema.decodeSync(field);
    expect(decodeField(undefined)).toBeUndefined();
    expect(decodeField("ask")).toBe("ask");
    expect(decodeField("default")).toBe("default");
  });
});
