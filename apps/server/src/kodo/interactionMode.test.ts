import { describe, expect, it } from "@effect/vitest";
import { KODO_INTERACTION_MODES, type RuntimeMode } from "@t3tools/contracts";
import { parseKodoReview } from "@t3tools/shared/kodoLoopOutput";

import {
  KODO_ASK_MODE_INSTRUCTIONS,
  KODO_CODE_MODE_INSTRUCTIONS,
  KODO_PLAN_MODE_INSTRUCTIONS,
  KODO_REVIEW_MODE_INSTRUCTIONS,
  ENFORCEMENT_BY_DRIVER,
  kodoEffectiveRunMode,
  kodoEffectiveRuntimeMode,
  kodoInteractionModeRestriction,
  kodoMaySteerIntoRun,
  kodoMoreRestrictiveMode,
  kodoSessionNeedsRestart,
  kodoSessionPolicyKey,
  kodoRunModeSnapshot,
  kodoInteractionModeChangesEffectivePolicy,
  kodoInteractionModeLimit,
  kodoInteractionModeRank,
  kodoModeSwitchDetachSessionIds,
  kodoRuntimePolicyOverlay,
  kodoSteerText,
  makeKodoModeAnnouncer,
  resolveKodoInteractionMode,
  withKodoModeInstructions,
} from "./interactionMode.ts";

const resolve = (mode: unknown, driver: string | undefined) =>
  resolveKodoInteractionMode({ mode, driver });

const ALL_DRIVERS = [
  "claudeAgent",
  "codex",
  "cursor",
  "opencode",
  "acp",
  "acpRegistry",
  "grok",
  "kiro",
  "fx",
  "antigravity",
  "pi",
  "muse",
  "custom",
  undefined,
] as const;

const TEXT = {
  ask: KODO_ASK_MODE_INSTRUCTIONS,
  review: KODO_REVIEW_MODE_INSTRUCTIONS,
  plan: KODO_PLAN_MODE_INSTRUCTIONS,
} as const;

/** The enforcement table: what each read-only mode resolves to for each driver. */
interface Cell {
  readonly wire: "default" | "plan";
  readonly sandbox: boolean;
  readonly approval: "never" | undefined;
  /** Whether the Kodo instruction text is delivered (Plan on a native plan mode adds none). */
  readonly text: boolean;
  readonly suppressPlanCapture?: true;
}
const cell = (
  wire: Cell["wire"],
  sandbox: boolean,
  approval: Cell["approval"],
  text: boolean,
  suppressPlanCapture?: true,
): Cell => ({
  wire,
  sandbox,
  approval,
  text,
  ...(suppressPlanCapture === undefined ? {} : { suppressPlanCapture }),
});

const ENFORCEMENT_TABLE: Record<"ask" | "review" | "plan", Record<string, Cell>> = {
  ask: {
    claudeAgent: cell("default", true, "never", true),
    codex: cell("default", true, "never", true),
    cursor: cell("plan", false, undefined, true, true),
    opencode: cell("default", true, "never", true),
    acp: cell("default", true, "never", true),
    acpRegistry: cell("default", true, "never", true),
    grok: cell("default", true, "never", true),
    kiro: cell("default", true, "never", true),
    fx: cell("default", true, "never", true),
    antigravity: cell("default", true, "never", true),
    // Launched without write and shell tools; the approval policy "never" tells the adapter.
    pi: cell("default", false, "never", true),
    muse: cell("default", false, "never", true),
    custom: cell("default", false, undefined, true),
    undefined: cell("default", false, undefined, true),
  },
  review: {
    // Claude: edit tools disallowed, shell on user approval. Others with a deny policy: shell stays
    // on user approval because approvalPolicy is left unset.
    claudeAgent: cell("default", false, undefined, true),
    codex: cell("default", true, "never", true),
    cursor: cell("plan", false, undefined, true, true),
    opencode: cell("default", true, undefined, true),
    acp: cell("default", true, undefined, true),
    acpRegistry: cell("default", true, undefined, true),
    grok: cell("default", true, undefined, true),
    kiro: cell("default", true, undefined, true),
    fx: cell("default", true, undefined, true),
    antigravity: cell("default", true, undefined, true),
    pi: cell("default", false, undefined, true),
    muse: cell("default", false, undefined, true),
    custom: cell("default", false, undefined, true),
    undefined: cell("default", false, undefined, true),
  },
  plan: {
    claudeAgent: cell("plan", false, "never", false),
    codex: cell("plan", true, "never", false),
    cursor: cell("plan", false, undefined, false),
    opencode: cell("plan", true, "never", false),
    acp: cell("plan", true, "never", false),
    acpRegistry: cell("plan", true, "never", false),
    grok: cell("plan", true, "never", false),
    kiro: cell("default", true, "never", true),
    fx: cell("default", true, "never", true),
    antigravity: cell("default", true, "never", true),
    pi: cell("default", false, "never", true),
    muse: cell("default", false, "never", true),
    custom: cell("default", false, undefined, true),
    // An unresolved driver fails closed: no native plan mode is assumed.
    undefined: cell("default", false, undefined, true),
  },
};

describe("resolveKodoInteractionMode", () => {
  it.each(["default", "code", "swarm", undefined])(
    "treats %j as code: the upstream default, no extras, for every driver",
    (mode) => {
      for (const driver of ALL_DRIVERS) {
        expect(resolve(mode, driver)).toEqual({
          mode: "code",
          wireInteractionMode: "default",
          instructions: undefined,
          runtimeModeCeiling: undefined,
          sandboxPolicy: undefined,
          approvalPolicy: undefined,
          readOnly: false,
          suppressPlanCapture: false,
        });
      }
    },
  );

  describe.each(["ask", "review", "plan"] as const)("%s", (mode) => {
    it.each(ALL_DRIVERS.map((driver) => [String(driver), driver] as const))(
      "resolves for the %s driver",
      (name, driver) => {
        const expected = ENFORCEMENT_TABLE[mode][name]!;
        expect(resolve(mode, driver)).toEqual({
          mode,
          wireInteractionMode: expected.wire,
          instructions: expected.text ? TEXT[mode] : undefined,
          runtimeModeCeiling: "approval-required",
          sandboxPolicy: expected.sandbox ? { type: "readOnly" } : undefined,
          approvalPolicy: expected.approval,
          readOnly: true,
          suppressPlanCapture: expected.suppressPlanCapture === true,
        });
      },
    );
  });

  it("never suppresses plan capture for Plan, and only where the wire mode is plan", () => {
    for (const driver of ALL_DRIVERS) {
      expect(resolve("plan", driver).suppressPlanCapture).toBe(false);
      for (const mode of ["ask", "review"] as const) {
        const resolution = resolve(mode, driver);
        expect(resolution.suppressPlanCapture).toBe(resolution.wireInteractionMode === "plan");
      }
    }
  });

  it("keeps Ask and Review out of the provider's plan mode wherever a stronger policy exists", () => {
    for (const driver of ALL_DRIVERS) {
      if (driver === "cursor") continue;
      for (const mode of ["ask", "review"] as const) {
        expect(resolve(mode, driver).wireInteractionMode).toBe("default");
      }
    }
  });

  it("hard-denies shell in Ask and Plan, and leaves it on approval in Review, where a deny policy exists", () => {
    for (const driver of ["opencode", "acp", "acpRegistry", "grok", "kiro", "fx", "antigravity"]) {
      expect(resolve("ask", driver).approvalPolicy).toBe("never");
      expect(resolve("plan", driver).approvalPolicy).toBe("never");
      expect(resolve("review", driver).approvalPolicy).toBeUndefined();
      expect(resolve("review", driver).sandboxPolicy).toEqual({ type: "readOnly" });
    }
  });

  it("tells the model the restriction lasts for the thread, not for one request", () => {
    for (const text of Object.values(TEXT)) {
      expect(text).toContain("must not modify files");
      expect(text).toContain("stays in force for the whole thread");
      expect(text).not.toContain("A later request without this block is not bound by it");
    }
    expect(KODO_CODE_MODE_INSTRUCTIONS).toContain("no longer applies");
    expect(KODO_CODE_MODE_INSTRUCTIONS).toContain("you may modify files");
  });

  it("does not ask Review to produce a separate plan", () => {
    expect(KODO_REVIEW_MODE_INSTRUCTIONS).toContain(
      "Do not produce a separate implementation plan",
    );
  });

  it("asks Review to end with a kodo-review block whose example the shared parser accepts", () => {
    expect(KODO_REVIEW_MODE_INSTRUCTIONS).toContain(
      "exactly one fenced block labelled `kodo-review`",
    );
    const example = parseKodoReview(KODO_REVIEW_MODE_INSTRUCTIONS);
    expect(example.ok).toBe(true);
  });
});

describe("runtime mode ceiling", () => {
  it("plan counts as non-writing for delegation", () => {
    expect(kodoInteractionModeRank("plan")).toBe(0);
  });

  it("caps every read-only mode on every driver, never raises, and leaves code alone", () => {
    for (const driver of ALL_DRIVERS) {
      for (const interactionMode of ["ask", "review", "plan"]) {
        expect(
          kodoEffectiveRuntimeMode({ runtimeMode: "full-access", interactionMode, driver }),
        ).toBe("approval-required");
      }
      for (const interactionMode of ["code", "default"]) {
        expect(
          kodoEffectiveRuntimeMode({ runtimeMode: "full-access", interactionMode, driver }),
        ).toBe("full-access");
      }
      expect(
        kodoEffectiveRuntimeMode({
          runtimeMode: "approval-required",
          interactionMode: "ask",
          driver,
        }),
      ).toBe("approval-required");
    }
  });

  it("compares the whole effective policy, not only the runtime mode", () => {
    const change = (
      from: string,
      to: string,
      driver: string,
      runtimeMode: RuntimeMode = "full-access",
    ) => kodoInteractionModeChangesEffectivePolicy({ runtimeMode, from, to, driver });
    // The ceiling moves.
    expect(change("code", "ask", "grok")).toBe(true);
    expect(change("review", "code", "grok")).toBe(true);
    // The runtime mode is already at the ceiling, but the sandbox and approval policy move.
    expect(change("code", "ask", "grok", "approval-required")).toBe(true);
    expect(change("code", "ask", "claudeAgent", "approval-required")).toBe(true);
    expect(change("ask", "review", "grok")).toBe(true);
    expect(change("ask", "review", "codex")).toBe(false);
    // The wire mode moves.
    expect(change("ask", "plan", "cursor")).toBe(false);
    expect(change("ask", "plan", "opencode")).toBe(true);
    // Legacy default and code are the same mode.
    expect(change("default", "code", "grok")).toBe(false);
    expect(change("code", "swarm", "grok")).toBe(false);
  });

  it("detaches only the sessions that cannot take the new policy in place", () => {
    const sessions = [
      {
        id: "claude",
        driver: "claudeAgent",
        capabilities: { sessions: { supportsRuntimeModeSwitchInSession: false } },
      },
      {
        id: "codex",
        driver: "codex",
        capabilities: { sessions: { supportsRuntimeModeSwitchInSession: true } },
      },
      {
        id: "grok",
        driver: "grok",
        capabilities: { sessions: { supportsRuntimeModeSwitchInSession: false } },
      },
    ];
    expect(
      kodoModeSwitchDetachSessionIds({ runtimeMode: "auto", from: "code", to: "ask", sessions }),
    ).toEqual(["claude", "grok"]);
    expect(
      kodoModeSwitchDetachSessionIds({
        runtimeMode: "auto",
        from: "code",
        to: "default",
        sessions,
      }),
    ).toEqual([]);
  });

  it("builds the runtime-policy overlay adapters receive", () => {
    expect(
      kodoRuntimePolicyOverlay({
        interactionMode: "review",
        driver: "codex",
        runtimeMode: "full-access",
      }),
    ).toEqual({
      runtimeMode: "approval-required",
      interactionMode: "default",
      sandboxPolicy: { type: "readOnly" },
      approvalPolicy: "never",
      modeInstructions: KODO_REVIEW_MODE_INSTRUCTIONS,
      modeReadOnly: true,
    });
    expect(
      kodoRuntimePolicyOverlay({
        interactionMode: "default",
        driver: "grok",
        runtimeMode: "auto",
      }),
    ).toEqual({ runtimeMode: "auto", interactionMode: "default" });
    expect(
      kodoRuntimePolicyOverlay({ interactionMode: "ask", driver: "cursor", runtimeMode: "auto" }),
    ).toEqual({
      runtimeMode: "approval-required",
      interactionMode: "plan",
      modeInstructions: KODO_ASK_MODE_INSTRUCTIONS,
      modeReadOnly: true,
      modeSuppressesPlanCapture: true,
    });
    // Accepting a plan switches the thread to code, which drops every read-only restriction.
    const overlay = (interactionMode: string) =>
      kodoRuntimePolicyOverlay({ interactionMode, driver: "claudeAgent", runtimeMode: "auto" });
    expect(overlay("plan")).toEqual({
      runtimeMode: "approval-required",
      interactionMode: "plan",
      approvalPolicy: "never",
      modeReadOnly: true,
    });
    expect(overlay("code")).toEqual({ runtimeMode: "auto", interactionMode: "default" });
  });
});

describe("withKodoModeInstructions", () => {
  it("prefixes the user's text, and leaves native slash commands first", () => {
    expect(withKodoModeInstructions({ text: "why?", id: 1 }, "RULES")).toEqual({
      text: "RULES\n\nwhy?",
      id: 1,
    });
    const slash = { text: "/compact" };
    expect(withKodoModeInstructions(slash, "RULES")).toBe(slash);
    const plain = { text: "hi" };
    expect(withKodoModeInstructions(plain, undefined)).toBe(plain);
  });
});

describe("makeKodoModeAnnouncer", () => {
  const apply = (
    announcer: ReturnType<typeof makeKodoModeAnnouncer>,
    text: string,
    mode: string,
    hasPriorTurns = true,
    threadId = "thread-1",
  ) =>
    announcer.apply(
      { text },
      {
        threadId,
        mode,
        instructions: resolve(mode, "claudeAgent").instructions,
        hasPriorTurns,
      },
    ).text;

  it("puts the restriction on every message of a read-only thread", () => {
    const announcer = makeKodoModeAnnouncer();
    expect(apply(announcer, "why?", "ask", false)).toBe(`${KODO_ASK_MODE_INSTRUCTIONS}\n\nwhy?`);
    expect(apply(announcer, "and this?", "ask")).toBe(`${KODO_ASK_MODE_INSTRUCTIONS}\n\nand this?`);
  });

  it("tells the model it may write again when a read-only thread moves to Code, once", () => {
    const announcer = makeKodoModeAnnouncer();
    apply(announcer, "why?", "ask", false);
    expect(apply(announcer, "go ahead", "code")).toBe(`${KODO_CODE_MODE_INSTRUCTIONS}\n\ngo ahead`);
    expect(apply(announcer, "next", "code")).toBe("next");
    // Plan counts as a restriction too, native plan mode or not.
    apply(announcer, "plan it", "plan");
    expect(apply(announcer, "implement", "default")).toBe(
      `${KODO_CODE_MODE_INSTRUCTIONS}\n\nimplement`,
    );
  });

  it("adds nothing to a thread that was always Code, but announces an existing thread it never saw", () => {
    const announcer = makeKodoModeAnnouncer();
    expect(apply(announcer, "hi", "code", false)).toBe("hi");
    expect(apply(announcer, "hi again", "code")).toBe("hi again");
    // After a restart the memory is empty and the thread already has turns.
    const restarted = makeKodoModeAnnouncer();
    expect(apply(restarted, "continue", "code", true, "thread-2")).toBe(
      `${KODO_CODE_MODE_INSTRUCTIONS}\n\ncontinue`,
    );
    expect(apply(restarted, "continue", "code", true, "thread-2")).toBe("continue");
  });

  it("leaves native slash commands as typed and does not count them as delivered", () => {
    const announcer = makeKodoModeAnnouncer();
    apply(announcer, "why?", "ask", false);
    expect(apply(announcer, "/compact", "code")).toBe("/compact");
    expect(apply(announcer, "go ahead", "code")).toBe(`${KODO_CODE_MODE_INSTRUCTIONS}\n\ngo ahead`);
  });

  it("carries the thread's mode on a steered message", () => {
    expect(
      kodoSteerText("also check x", { threadId: "steer-1", mode: "ask", driver: "codex" }),
    ).toBe(`${KODO_ASK_MODE_INSTRUCTIONS}\n\nalso check x`);
    expect(
      kodoSteerText("also check x", { threadId: "steer-2", mode: "review", driver: undefined }),
    ).toBe(`${KODO_REVIEW_MODE_INSTRUCTIONS}\n\nalso check x`);
  });
});

describe("delegation limits", () => {
  it("ranks only code as writing, and bounds peers by upstream's narrow modes", () => {
    expect(["ask", "plan", "review"].map(kodoInteractionModeRank)).toEqual([0, 0, 0]);
    expect(["code", "default", "swarm"].map(kodoInteractionModeRank)).toEqual([1, 1, 1]);
    expect(kodoInteractionModeLimit("review")).toBe("plan");
    expect(kodoInteractionModeLimit("code")).toBe("default");
  });
});

// KODO: run-mode-snapshot - a run never starts with more write access than the mode it was created in.
describe("kodoEffectiveRunMode", () => {
  it.each(["ask", "review", "plan"] as const)(
    "keeps a run queued in %s read-only after the thread moves to Code",
    (queued) => {
      expect(kodoEffectiveRunMode(queued, "code")).toBe(queued);
      expect(kodoEffectiveRunMode(queued, "default")).toBe(queued);
    },
  );

  it.each(["ask", "review", "plan"] as const)(
    "runs a run queued in Code read-only once the thread moves to %s",
    (current) => {
      expect(kodoEffectiveRunMode("code", current)).toBe(current);
    },
  );

  it("takes the thread's mode when the run has no snapshot, including legacy runs", () => {
    expect(kodoEffectiveRunMode(undefined, "ask")).toBe("ask");
    expect(kodoEffectiveRunMode(undefined, "code")).toBe("code");
    expect(kodoEffectiveRunMode(undefined, "default")).toBe("code");
  });

  it("runs the plan-accept implementation turn, created in Code, writable", () => {
    const created = kodoRunModeSnapshot("code");
    expect(created).toEqual({ interactionMode: "code" });
    expect(kodoEffectiveRunMode(created.interactionMode, "code")).toBe("code");
    expect(
      resolveKodoInteractionMode({ mode: kodoEffectiveRunMode("code", "code"), driver: "codex" })
        .readOnly,
    ).toBe(false);
  });

  it("records a normalized snapshot, so a legacy default is stored as code", () => {
    expect(kodoRunModeSnapshot("default")).toEqual({ interactionMode: "code" });
    expect(kodoRunModeSnapshot("review")).toEqual({ interactionMode: "review" });
  });
});

// KODO: mode-restriction-order - Ask is the most restrictive, then Plan, then Review, then Code.
describe("restrictiveness order and the effective run mode", () => {
  const ORDER = ["ask", "plan", "review", "code"] as const;

  it("orders the four modes, most restrictive first", () => {
    expect(ORDER.map(kodoInteractionModeRestriction)).toEqual([3, 2, 1, 0]);
    expect(kodoInteractionModeRestriction("default")).toBe(0);
  });

  it.each(
    KODO_INTERACTION_MODES.flatMap((created) =>
      KODO_INTERACTION_MODES.map((current) => [created, current] as const),
    ),
  )(
    "a run created in %s on a thread now in %s runs as the more restrictive",
    (created, current) => {
      const expected = ORDER.find((mode) => mode === created || mode === current)!;
      expect(kodoEffectiveRunMode(created, current)).toBe(expected);
      expect(kodoMoreRestrictiveMode(created, current)).toBe(expected);
    },
  );

  it("reads legacy default as code in the table", () => {
    expect(kodoEffectiveRunMode("default", "ask")).toBe("ask");
    expect(kodoEffectiveRunMode("review", "default")).toBe("review");
  });
});

// KODO: mode-steer-guard
describe("kodoMaySteerIntoRun", () => {
  it.each(
    KODO_INTERACTION_MODES.flatMap((run) =>
      KODO_INTERACTION_MODES.map((thread) => [run, thread] as const),
    ),
  )(
    "a run created in %s takes a steer from a thread in %s only when the modes match",
    (run, thread) => {
      expect(kodoMaySteerIntoRun(run, thread)).toBe(run === thread);
    },
  );

  it("lets a run with no recorded mode be steered, and reads legacy default as code", () => {
    expect(kodoMaySteerIntoRun(undefined, "ask")).toBe(true);
    expect(kodoMaySteerIntoRun("default", "code")).toBe(true);
    expect(kodoMaySteerIntoRun("code", "default")).toBe(true);
  });
});

// KODO: mode-session-policy
describe("provider session policy", () => {
  const codePolicy = (runtimeMode: RuntimeMode = "full-access") =>
    kodoSessionPolicyKey(
      kodoRuntimePolicyOverlay({ interactionMode: "code", driver: "grok", runtimeMode }),
    );
  const policyFor = (mode: string, driver: string) =>
    kodoSessionPolicyKey(
      kodoRuntimePolicyOverlay({ interactionMode: mode, driver, runtimeMode: "full-access" }),
    );

  it("differs between Code and every read-only mode, and between Ask and Review on launch drivers", () => {
    for (const driver of ["grok", "kiro", "cursor", "pi", "muse", "codex", "claudeAgent"]) {
      for (const mode of ["ask", "plan", "review"]) {
        expect(policyFor(mode, driver)).not.toBe(policyFor("code", driver));
      }
    }
    expect(policyFor("ask", "pi")).not.toBe(policyFor("review", "pi"));
    expect(policyFor("ask", "muse")).not.toBe(policyFor("review", "muse"));
    expect(policyFor("code", "grok")).toBe(codePolicy());
  });

  it("restarts a session whose driver fixes any part of the policy at open", () => {
    const opened = codePolicy();
    const asking = policyFor("ask", "grok");
    for (const driver of [
      "grok",
      "kiro",
      "fx",
      "cursor",
      "acp",
      "acpRegistry",
      "pi",
      "muse",
      undefined,
    ]) {
      expect(kodoSessionNeedsRestart({ driver, opened, next: asking })).toBe(true);
      // The reverse direction: a Code run must not reuse the session an Ask run opened.
      expect(kodoSessionNeedsRestart({ driver, opened: asking, next: opened })).toBe(true);
      expect(kodoSessionNeedsRestart({ driver, opened, next: opened })).toBe(false);
    }
  });

  it("keeps a session whose driver re-applies the whole policy on every turn", () => {
    for (const driver of ["claudeAgent", "codex", "opencode", "antigravity"]) {
      expect(
        kodoSessionNeedsRestart({ driver, opened: codePolicy(), next: policyFor("ask", driver) }),
      ).toBe(false);
    }
  });

  it("pins where each built-in driver applies its policy", () => {
    expect(
      Object.fromEntries(Object.entries(ENFORCEMENT_BY_DRIVER).map(([d, e]) => [d, e.policyScope])),
    ).toEqual({
      claudeAgent: "turn",
      codex: "turn",
      cursor: "session",
      opencode: "turn",
      acp: "session",
      acpRegistry: "session",
      grok: "session",
      kiro: "session",
      fx: "session",
      antigravity: "turn",
      pi: "session",
      muse: "session",
    });
  });
});
