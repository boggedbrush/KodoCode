import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_KODO_MODE_MODELS,
  EnvironmentId,
  ProviderInstanceId,
  type KodoModeModels,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { resolveChildInteractionMode } from "../../mcp/delegatedTaskModes.ts";
import {
  kodoLeadMayStartMode,
  kodoLeadWorkerMode,
  kodoLeadWorkerTarget,
  kodoWorkerInstanceIds,
  normalizeLeadDelegation,
} from "./leadDelegation.ts";

const MODES = ["code", "review", "plan", "ask"] as const;
const ROLES = [
  "implementation",
  "test",
  "review",
  "research",
  "design",
  "general",
  undefined,
] as const;

describe("the mode a lead's worker runs in", () => {
  // The thread's mode table from the design: what each kind of lead may be given, by role.
  it.each([
    ["code", "implementation", "code"],
    ["code", "test", "code"],
    ["code", "review", "review"],
    ["code", "research", "ask"],
    ["code", "design", "plan"],
    ["code", "general", "inherit"],
    ["code", undefined, "inherit"],
    ["review", "review", "review"],
    ["review", "implementation", "review"],
    ["review", "research", "ask"],
    ["plan", "research", "ask"],
    ["plan", "design", "plan"],
    ["plan", "implementation", "plan"],
    ["plan", "review", "plan"],
    ["ask", "research", "ask"],
    ["ask", "design", "ask"],
    ["ask", "implementation", "ask"],
    ["ask", "review", "ask"],
  ] as const)("a %s lead naming role %s gets a %s worker", (leadMode, role, expected) => {
    expect(kodoLeadWorkerMode({ leadMode, role, requested: undefined })).toBe(expected);
  });

  it("never hands a role-derived mode that the lead's own mode cannot start", () => {
    for (const leadMode of MODES) {
      for (const role of ROLES) {
        const mode = kodoLeadWorkerMode({ leadMode, role, requested: undefined });
        if (mode === "inherit") continue;
        expect(kodoLeadMayStartMode(leadMode, mode)).toBe(true);
      }
    }
  });

  it("passes an explicit mode through unchanged, so the child-mode limit refuses an escalation itself", () => {
    expect(kodoLeadWorkerMode({ leadMode: "plan", role: "review", requested: "default" })).toBe(
      "default",
    );
    expect(kodoLeadWorkerMode({ leadMode: "code", role: "review", requested: "plan" })).toBe(
      "plan",
    );
  });
});

describe("a read-only thread only ever gets read-only workers, by every request a lead can make", () => {
  // Through the real child-mode limit, which runs after the normalizer on every route.
  const outcome = (
    leadMode: (typeof MODES)[number],
    role: (typeof ROLES)[number],
    interactionMode: "default" | "plan" | "inherit" | undefined,
  ) => {
    const normalized = normalizeLeadDelegation({ role, interactionMode }, leadMode);
    return resolveChildInteractionMode(leadMode, normalized.interactionMode).pipe(
      Effect.map((mode) => ({ ok: true as const, mode })),
      Effect.catch((error) => Effect.succeed({ ok: false as const, code: error.code })),
    );
  };

  it.effect(
    "by role alone: Ask, Plan and Review leads never get a Code worker, a Code lead can",
    () =>
      Effect.gen(function* () {
        for (const leadMode of ["ask", "plan", "review"] as const) {
          for (const role of ROLES) {
            const result = yield* outcome(leadMode, role, undefined);
            expect(result.ok, `${leadMode}/${role}`).toBe(true);
            if (result.ok) expect(["code", "default"]).not.toContain(result.mode);
          }
        }
        expect(yield* outcome("code", "implementation", undefined)).toEqual({
          ok: true,
          mode: "code",
        });
        expect(yield* outcome("code", "review", undefined)).toEqual({ ok: true, mode: "review" });
      }),
  );

  it.effect(
    "by an explicit Code mode: refused for every read-only lead, whatever the role says",
    () =>
      Effect.gen(function* () {
        for (const leadMode of ["ask", "plan", "review"] as const) {
          for (const role of ROLES) {
            expect(yield* outcome(leadMode, role, "default"), `${leadMode}/${role}`).toEqual({
              ok: false,
              code: "interaction_mode_escalation_denied",
            });
          }
        }
      }),
  );
});

describe("what a lead's target keeps", () => {
  const target = {
    providerInstanceId: ProviderInstanceId.make("codex"),
    model: "gpt-x",
    options: [{ id: "effort", value: "max" }],
    environmentId: EnvironmentId.make("environment:other"),
  } as never;

  it("drops every model, provider, driver and option, and keeps only where the worker runs", () => {
    expect(kodoLeadWorkerTarget(target)).toEqual({
      environmentId: EnvironmentId.make("environment:other"),
    });
    expect(kodoLeadWorkerTarget({ model: "m", driverKind: "codex" } as never)).toBeUndefined();
    expect(kodoLeadWorkerTarget(undefined)).toBeUndefined();
  });

  it("applies to the whole call and leaves its other fields", () => {
    const normalized = normalizeLeadDelegation(
      { task: "Do it", title: "T", role: "implementation" as const, target },
      "code",
    );
    expect(normalized).toMatchObject({ task: "Do it", title: "T", interactionMode: "code" });
    expect(normalized.target).toEqual({ environmentId: EnvironmentId.make("environment:other") });
  });
});

describe("the provider instances a worker could run on", () => {
  const slot = (instanceId: string): KodoModeModels => ({
    ...DEFAULT_KODO_MODE_MODELS,
    code: { instanceId: ProviderInstanceId.make(instanceId), model: "m" },
  });
  it("is the inherited one when the mode has no slot or the slot is on the same instance", () => {
    expect(
      kodoWorkerInstanceIds({ modeModels: DEFAULT_KODO_MODE_MODELS, mode: "code", inherited: "a" }),
    ).toEqual(["a"]);
    expect(kodoWorkerInstanceIds({ modeModels: slot("a"), mode: "code", inherited: "a" })).toEqual([
      "a",
    ]);
  });
  it("is both the slot's and the inherited one when they differ, since which runs is decided at dispatch", () => {
    expect(kodoWorkerInstanceIds({ modeModels: slot("b"), mode: "code", inherited: "a" })).toEqual([
      "b",
      "a",
    ]);
    // The review slot is not read for a code worker.
    expect(
      kodoWorkerInstanceIds({ modeModels: slot("b"), mode: "review", inherited: "a" }),
    ).toEqual(["a"]);
  });
});
