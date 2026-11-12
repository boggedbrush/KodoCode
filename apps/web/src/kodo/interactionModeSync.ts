import type { KodoInteractionMode } from "@t3tools/contracts";

export type KodoModeSyncOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string; readonly silent?: boolean };

export interface KodoModeSyncDeps {
  /** Writes the mode to the server thread. Never throws; a failure is an outcome. */
  readonly send: (mode: KodoInteractionMode) => Promise<KodoModeSyncOutcome>;
  /** The mode the server thread last reported. */
  readonly getServerMode: () => KodoInteractionMode;
  /** The mode to show in place of the server's while a change is on its way; null once it is not. */
  readonly onPendingChange: (mode: KodoInteractionMode | null) => void;
  /** A change that did not reach the server, after the display went back to the server's mode. */
  readonly onFailure: (message: string) => void;
  /** How long an acknowledged change may wait for the server to echo it. */
  readonly graceMs?: number;
}

export interface KodoModeSync {
  /** Show `mode` now and make the server end on it. Rapid calls coalesce into the latest. */
  readonly request: (mode: KodoInteractionMode) => void;
  /** Like `request`, resolving once the server holds the final mode or the change failed. */
  readonly commit: (mode: KodoInteractionMode) => Promise<KodoModeSyncOutcome>;
  /** Tell the sync what the server reports, so an acknowledged change stops overriding it. */
  readonly observeServerMode: (mode: KodoInteractionMode) => void;
  /** The pick not yet echoed by the server, so a quick second pick builds on it, not on a stale render. */
  readonly pendingMode: () => KodoInteractionMode | null;
  /** Binds the sync to a mounted component; the returned function unbinds it. */
  readonly attach: () => () => void;
}

const DEFAULT_GRACE_MS = 2_000;

/**
 * Turns picker changes into `thread.interaction-mode.set` commands, one at a time and in order.
 * While a command is in flight, later picks only replace the mode that goes out next, so a burst
 * of Shift+Tab sends a few commands, not one per press, and the server ends on the last pick.
 * The server's mode stays the truth: a failed change drops the pick and reports the error.
 */
export function createKodoModeSync(deps: KodoModeSyncDeps): KodoModeSync {
  const graceMs = deps.graceMs ?? DEFAULT_GRACE_MS;
  // The latest pick; null once the server reported its state or the pick was given up.
  let desired: KodoInteractionMode | null = null;
  let inFlight = false;
  let lastObserved: KodoInteractionMode | null = null;
  let disposed = false;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let waiters: Array<(outcome: KodoModeSyncOutcome) => void> = [];

  const clearGraceTimer = () => {
    if (graceTimer === null) return;
    clearTimeout(graceTimer);
    graceTimer = null;
  };
  const release = () => {
    clearGraceTimer();
    desired = null;
    if (!disposed) deps.onPendingChange(null);
  };
  const settle = (outcome: KodoModeSyncOutcome) => {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve(outcome);
  };

  const pump = async () => {
    if (inFlight) return;
    inFlight = true;
    let outcome: KodoModeSyncOutcome = { ok: true };
    try {
      let mode = desired;
      while (mode !== null) {
        outcome = await deps.send(mode);
        // A newer pick goes out whether or not this one landed.
        mode = desired === mode ? null : desired;
      }
    } finally {
      inFlight = false;
    }
    if (outcome.ok) {
      clearGraceTimer();
      // The server echoes the mode shortly; if it never does, the server's value wins after the grace.
      graceTimer = setTimeout(release, graceMs);
    } else {
      release();
      if (!disposed && outcome.silent !== true) deps.onFailure(outcome.message);
    }
    settle(outcome);
  };

  const request = (mode: KodoInteractionMode) => {
    if (!inFlight && desired === null && mode === deps.getServerMode()) {
      // Already what the server holds: nothing to send.
      settle({ ok: true });
      return;
    }
    if (!inFlight && desired === mode) {
      // Acknowledged, and only the server's echo is outstanding.
      settle({ ok: true });
      return;
    }
    clearGraceTimer();
    desired = mode;
    if (!disposed) deps.onPendingChange(mode);
    void pump();
  };

  return {
    request,
    commit: (mode) =>
      new Promise((resolve) => {
        waiters.push(resolve);
        request(mode);
      }),
    observeServerMode: (mode) => {
      const changed = lastObserved !== null && lastObserved !== mode;
      lastObserved = mode;
      // The echo of the pick, or another client's change, ends the override.
      if (!inFlight && desired !== null && (mode === desired || changed)) release();
    },
    pendingMode: () => desired,
    attach: () => {
      disposed = false;
      return () => {
        disposed = true;
        clearGraceTimer();
      };
    },
  };
}
