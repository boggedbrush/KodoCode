import { describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";

import { decideKodoLeadSet, kodoLeadCreateRefusal, type KodoLeadSetInput } from "./leadControl.ts";

const thread = ThreadId.make("thread:lead");
const sender = ThreadId.make("thread:sender");

const base = (over: Partial<KodoLeadSetInput> = {}): KodoLeadSetInput => ({
  requested: { kind: "sub-agents" },
  thread: { id: thread, interactionMode: "code" },
  busy: false,
  liveWorkers: 0,
  underLead: false,
  supportRefusal: undefined,
  actor: { createdBy: "user", senderIsTargetOrAncestor: false },
  ...over,
});

const refusal = (over: Partial<KodoLeadSetInput>) => {
  const decided = decideKodoLeadSet(base(over));
  return decided.ok ? undefined : decided.message;
};

describe("turning sub-agents on or off", () => {
  it("lets a person switch an idle thread on and off", () => {
    expect(decideKodoLeadSet(base())).toEqual({ ok: true, lead: { kind: "sub-agents" } });
    expect(decideKodoLeadSet(base({ requested: null }))).toEqual({ ok: true, lead: null });
  });

  it("refuses a kind this build does not have", () => {
    expect(refusal({ requested: { kind: "swarm" } })).toMatch(/Only sub-agents/);
  });

  it("refuses while a turn is running, in both directions", () => {
    expect(refusal({ busy: true })).toMatch(/turn is running/);
    expect(refusal({ busy: true, requested: null })).toMatch(/turn is running/);
  });

  it.each(["active", "held"])("refuses while a loop is %s", (loopStatus) => {
    expect(refusal({ thread: { id: thread, interactionMode: "code", loopStatus } })).toMatch(
      /loop is running/,
    );
  });

  it("lets a finished loop's thread lead", () => {
    expect(
      refusal({ thread: { id: thread, interactionMode: "code", loopStatus: "done" } }),
    ).toBeUndefined();
  });

  it("refuses while workers run, so a worker never outlives the lead that makes it one", () => {
    expect(refusal({ liveWorkers: 2, requested: null })).toMatch(/2 workers are still running/);
  });

  it("refuses a thread that is itself a worker", () => {
    expect(refusal({ underLead: true })).toMatch(/worker of a lead/);
  });

  it("refuses with the provider's own reason", () => {
    expect(refusal({ supportRefusal: "No tools here." })).toBe("No tools here.");
    // Turning off never needs support.
    expect(refusal({ supportRefusal: "No tools here.", requested: null })).toBeUndefined();
  });
});

describe("who may switch it", () => {
  const agent = (over: Partial<KodoLeadSetInput["actor"]> = {}) => ({
    createdBy: "agent" as const,
    senderThreadId: sender,
    senderIsTargetOrAncestor: false,
    ...over,
  });

  it("lets an agent change another idle thread from Code mode", () => {
    expect(decideKodoLeadSet(base({ actor: agent(), limit: { interactionMode: "code" } })).ok).toBe(
      true,
    );
  });

  it("refuses an agent for its own thread or the thread it works under", () => {
    expect(refusal({ actor: agent({ senderIsTargetOrAncestor: true }) })).toMatch(
      /own thread or for the lead/,
    );
    expect(refusal({ actor: agent({ senderIsTargetOrAncestor: true }), requested: null })).toMatch(
      /own thread/,
    );
  });

  it("refuses an agent request that names no sender thread, which no honest route sends", () => {
    expect(refusal({ actor: { createdBy: "agent", senderIsTargetOrAncestor: false } })).toMatch(
      /cannot change/,
    );
    expect(refusal({ actor: { createdBy: "system", senderIsTargetOrAncestor: false } })).toMatch(
      /cannot change/,
    );
  });

  it.each(["ask", "plan", "review"])("refuses a sender limited to %s mode", (interactionMode) => {
    expect(refusal({ actor: agent(), limit: { interactionMode } })).toMatch(/read-only mode/);
  });
});

describe("a new thread", () => {
  it("starts as a lead only for a person, on a provider that can lead", () => {
    expect(kodoLeadCreateRefusal({ createdBy: "user", supportRefusal: undefined })).toBeUndefined();
    expect(kodoLeadCreateRefusal({ createdBy: "user", supportRefusal: "no" })).toBe("no");
    expect(kodoLeadCreateRefusal({ createdBy: "agent", supportRefusal: undefined })).toMatch(
      /Only a person/,
    );
    expect(kodoLeadCreateRefusal({ createdBy: "system", supportRefusal: undefined })).toMatch(
      /Only a person/,
    );
  });
});
