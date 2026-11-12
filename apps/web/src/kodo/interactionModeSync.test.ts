import type { KodoInteractionMode } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createKodoModeSync, type KodoModeSyncOutcome } from "./interactionModeSync";

function harness(initialServerMode: KodoInteractionMode = "code") {
  let serverMode = initialServerMode;
  const sent: KodoInteractionMode[] = [];
  const pending: Array<KodoInteractionMode | null> = [];
  const failures: string[] = [];
  const gates: Array<{
    mode: KodoInteractionMode;
    resolve: (outcome: KodoModeSyncOutcome) => void;
  }> = [];
  const sync = createKodoModeSync({
    send: (mode) => {
      sent.push(mode);
      return new Promise((resolve) => gates.push({ mode, resolve }));
    },
    getServerMode: () => serverMode,
    onPendingChange: (mode) => pending.push(mode),
    onFailure: (message) => failures.push(message),
    graceMs: 1_000,
  });
  sync.attach();
  const land = async (outcome: KodoModeSyncOutcome = { ok: true }) => {
    const gate = gates.shift()!;
    if (outcome.ok) serverMode = gate.mode;
    gate.resolve(outcome);
    await vi.advanceTimersByTimeAsync(0);
  };
  return {
    sync,
    sent,
    pending,
    failures,
    land,
    setServerMode: (mode: KodoInteractionMode) => {
      serverMode = mode;
    },
    openGates: () => gates.length,
  };
}

describe("kodo mode sync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a pick at once and shows it while it is on its way", async () => {
    const h = harness("code");
    h.sync.request("ask");
    expect(h.sent).toEqual(["ask"]);
    expect(h.pending.at(-1)).toBe("ask");
    await h.land();
    expect(h.pending.at(-1)).toBe("ask");
  });

  it("coalesces a burst into one command in flight and the latest pick after it", async () => {
    const h = harness("code");
    for (const mode of ["review", "ask", "plan", "code", "review", "ask", "plan"] as const) {
      h.sync.request(mode);
    }
    expect(h.sent).toEqual(["review"]);
    await h.land();
    expect(h.sent).toEqual(["review", "plan"]);
    await h.land();
    expect(h.sent).toEqual(["review", "plan"]);
    expect(h.openGates()).toBe(0);
    expect(h.pending.at(-1)).toBe("plan");
  });

  it("reports the pick that has not been echoed, for a press that outruns a render", async () => {
    const h = harness("code");
    expect(h.sync.pendingMode()).toBeNull();
    h.sync.request("ask");
    expect(h.sync.pendingMode()).toBe("ask");
    await h.land();
    expect(h.sync.pendingMode()).toBe("ask");
    h.sync.observeServerMode("ask");
    expect(h.sync.pendingMode()).toBeNull();
  });

  it("never has two commands in flight, so the server sees them in pick order", async () => {
    const h = harness("code");
    h.sync.request("ask");
    h.sync.request("plan");
    h.sync.request("review");
    expect(h.openGates()).toBe(1);
    await h.land();
    expect(h.openGates()).toBe(1);
    expect(h.sent).toEqual(["ask", "review"]);
  });

  it("sends nothing for a pick the server already holds", async () => {
    const h = harness("ask");
    h.sync.request("ask");
    expect(h.sent).toEqual([]);
    expect(await h.sync.commit("ask")).toEqual({ ok: true });
  });

  it("sends the return to the old mode while an acknowledged pick awaits its echo", async () => {
    const h = harness("code");
    h.sync.request("ask");
    await h.land();
    h.setServerMode("code");
    h.sync.request("code");
    expect(h.sent).toEqual(["ask", "code"]);
  });

  it("gives the display back to the server after an echo or the grace period", async () => {
    const h = harness("code");
    h.sync.request("ask");
    await h.land();
    h.sync.observeServerMode("ask");
    expect(h.pending.at(-1)).toBeNull();

    const slow = harness("code");
    slow.sync.request("plan");
    await slow.land();
    expect(slow.pending.at(-1)).toBe("plan");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(slow.pending.at(-1)).toBeNull();
  });

  it("does not release the pick while a command is still in flight", async () => {
    const h = harness("code");
    h.sync.request("ask");
    h.sync.observeServerMode("ask");
    expect(h.pending.at(-1)).toBe("ask");
  });

  it("follows another client's change after an acknowledged pick, not before the echo", async () => {
    const h = harness("code");
    h.sync.observeServerMode("code");
    h.sync.request("ask");
    await h.land();
    h.sync.observeServerMode("code");
    expect(h.pending.at(-1)).toBe("ask");
    h.sync.observeServerMode("review");
    expect(h.pending.at(-1)).toBeNull();
  });

  it("drops a failed pick, reports it, and shows the server's mode again", async () => {
    const h = harness("code");
    h.sync.request("ask");
    await h.land({ ok: false, message: "above the limit" });
    expect(h.pending.at(-1)).toBeNull();
    expect(h.failures).toEqual(["above the limit"]);
  });

  it("still sends a newer pick after an earlier one failed, and reports no error if it lands", async () => {
    const h = harness("code");
    h.sync.request("ask");
    h.sync.request("review");
    await h.land({ ok: false, message: "boom" });
    expect(h.sent).toEqual(["ask", "review"]);
    await h.land();
    expect(h.failures).toEqual([]);
    expect(h.pending.at(-1)).toBe("review");
  });

  it("keeps an interrupted command quiet", async () => {
    const h = harness("code");
    h.sync.request("ask");
    await h.land({ ok: false, message: "", silent: true });
    expect(h.failures).toEqual([]);
    expect(h.pending.at(-1)).toBeNull();
  });

  it("resolves a commit once the server holds the final mode", async () => {
    const h = harness("plan");
    const first = h.sync.commit("code");
    const second = h.sync.commit("code");
    await h.land();
    expect(await first).toEqual({ ok: true });
    expect(await second).toEqual({ ok: true });
    expect(h.sent).toEqual(["code"]);
  });

  it("resolves a commit as failed when its mode did not land", async () => {
    const h = harness("plan");
    const commit = h.sync.commit("code");
    await h.land({ ok: false, message: "denied" });
    expect(await commit).toEqual({ ok: false, message: "denied" });
  });

  it("does not resend a pick that was acknowledged and awaits its echo", async () => {
    const h = harness("plan");
    h.sync.request("code");
    await h.land();
    expect(await h.sync.commit("code")).toEqual({ ok: true });
    expect(h.sent).toEqual(["code"]);
  });
});
