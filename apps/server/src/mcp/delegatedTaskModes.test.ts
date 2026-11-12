import { describe, expect, it } from "@effect/vitest";
import { KODO_INTERACTION_MODES } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { resolveChildInteractionMode } from "./delegatedTaskModes.ts";

// KODO: mode-child-limit - a child never gets more authority than its parent.
describe("resolveChildInteractionMode", () => {
  const RESTRICTION = { ask: 3, plan: 2, review: 1, code: 0 } as const;

  it.effect.each(
    KODO_INTERACTION_MODES.flatMap((parent) =>
      KODO_INTERACTION_MODES.map((child) => [parent, child] as const),
    ),
  )("a %s parent starting a %s child", ([parent, child]) =>
    Effect.gen(function* () {
      const outcome = yield* Effect.result(resolveChildInteractionMode(parent, child));
      // Allowed only when the child is at least as restrictive as its parent.
      expect(outcome._tag === "Success").toBe(RESTRICTION[child] >= RESTRICTION[parent]);
      if (outcome._tag === "Failure") {
        expect(outcome.failure.code).toBe("interaction_mode_escalation_denied");
      }
    }),
  );

  it.effect("inherits the parent's mode and reads legacy default as code", () =>
    Effect.gen(function* () {
      expect(yield* resolveChildInteractionMode("ask", undefined)).toBe("ask");
      expect(yield* resolveChildInteractionMode("review", "inherit")).toBe("review");
      expect(yield* resolveChildInteractionMode("default", "ask")).toBe("ask");
      const denied = yield* Effect.flip(resolveChildInteractionMode("plan", "default"));
      expect(denied.code).toBe("interaction_mode_escalation_denied");
    }),
  );
});
