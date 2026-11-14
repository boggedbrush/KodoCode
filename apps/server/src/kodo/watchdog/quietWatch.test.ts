// KODO: quiet-watch - when a worker is flagged quiet, and when it is not. The clock is the test clock.
import { describe, expect, it } from "@effect/vitest";
import {
  KODO_QUIET_DEFAULT_MINUTES,
  ThreadId,
  type KodoQuiet,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";

import {
  decideQuiet,
  kodoQuietAfterMs,
  makeKodoQuietWatch,
  type QuietWatchShell,
} from "./quietWatch.ts";

const MIN = 60_000;
const START = Date.UTC(2026, 10, 14, 12, 0, 0);
const LEAD = ThreadId.make("lead");
const WORKER = ThreadId.make("worker");

describe("when a worker is quiet", () => {
  const base = {
    running: true,
    waitingOnPerson: false,
    lastEventMs: 0,
    nowMs: 5 * MIN,
    afterMs: 5 * MIN,
  };
  it.each([
    ["at the threshold", base, true],
    ["just before it", { ...base, nowMs: 5 * MIN - 1 }, false],
    ["while it waits on a person", { ...base, waitingOnPerson: true }, false],
    ["when its turn is not running", { ...base, running: false }, false],
    ["with the watchdog off", { ...base, afterMs: null }, false],
  ])("%s", (_name, input, expected) => {
    expect(decideQuiet(input)).toBe(expected);
  });

  it.each([
    [undefined, 5 * MIN],
    ["soon", 5 * MIN],
    [Number.NaN, 5 * MIN],
    [10, 10 * MIN],
    [2.9, 2 * MIN],
    [0, null],
    [-3, null],
    [9999, 240 * MIN],
  ])("reads the setting %s as %s", (setting, expected) => {
    expect(kodoQuietAfterMs(setting)).toBe(expected);
    expect(KODO_QUIET_DEFAULT_MINUTES).toBe(5);
  });
});

const shellOf = (over: Partial<QuietWatchShell> & { readonly id: ThreadId }): QuietWatchShell => ({
  status: "running",
  deletedAt: null,
  pendingRuntimeRequest: null,
  kodoQuiet: null,
  lineage: { parentThreadId: LEAD, relationshipToParent: "subagent" },
  ...over,
});

const setup = (
  options: { readonly minutes?: unknown; readonly shells?: ReadonlyArray<QuietWatchShell> } = {},
) =>
  Effect.gen(function* () {
    const shells = yield* Ref.make(
      new Map<ThreadId, QuietWatchShell>(
        (
          options.shells ?? [
            shellOf({
              id: LEAD,
              lineage: { parentThreadId: null },
              kodoLead: { kind: "sub-agents" },
            }),
            shellOf({ id: WORKER }),
          ]
        ).map((shell) => [shell.id, shell]),
      ),
    );
    const calls = yield* Ref.make<ReadonlyArray<readonly [ThreadId, KodoQuiet | null]>>([]);
    const minutes = yield* Ref.make<unknown>(options.minutes);
    // Runs as the watch reads a thread, to put an event in the gap a sweep leaves between its reads.
    const onRead = yield* Ref.make<Effect.Effect<void, { readonly _tag: string }> | null>(null);
    const watch = makeKodoQuietWatch({
      quietAfterMinutes: Ref.get(minutes),
      getShell: (id) =>
        Ref.get(onRead).pipe(
          Effect.flatMap((hook) => hook ?? Effect.void),
          Effect.andThen(Ref.get(shells)),
          Effect.map((all) => all.get(id) ?? null),
        ),
      listRunningWorkers: Ref.get(shells).pipe(
        Effect.map((all) =>
          // As the store lists them: every sub-agent thread, whatever its run is doing.
          [...all.values()]
            .filter((shell) => shell.lineage.relationshipToParent === "subagent")
            .map((shell) => shell.id),
        ),
      ),
      setQuiet: (id, quiet) =>
        Ref.update(calls, (all) => [...all, [id, quiet] as const]).pipe(
          // What the orchestrator would do with the command: the shell now carries the flag.
          Effect.andThen(
            Ref.update(shells, (all) => {
              const shell = all.get(id);
              return shell === undefined
                ? all
                : new Map(all).set(id, { ...shell, kodoQuiet: quiet });
            }),
          ),
        ),
    });
    const patch = (id: ThreadId, over: Partial<QuietWatchShell>) =>
      Ref.update(shells, (all) => new Map(all).set(id, { ...all.get(id)!, ...over }));
    const event = (type: string, threadId: ThreadId) =>
      watch.onEvent({
        type,
        threadId,
        occurredAt: DateTime.makeUnsafe(START + 0),
      } as unknown as OrchestrationV2DomainEvent);
    const eventAt = (type: string, threadId: ThreadId, atMs: number) =>
      watch.onEvent({
        type,
        threadId,
        occurredAt: DateTime.makeUnsafe(atMs),
      } as unknown as OrchestrationV2DomainEvent);
    yield* TestClock.setTime(START);
    return { watch, calls, patch, shells, event, eventAt, minutes, onRead };
  });

const flaggedNow = (calls: ReadonlyArray<readonly [ThreadId, KodoQuiet | null]>) =>
  calls.filter(([, quiet]) => quiet !== null).map(([id]) => id);

describe("the silence watchdog", () => {
  it.effect("flags a running worker at the threshold, with the time of its last event", () =>
    Effect.gen(function* () {
      const { watch, calls, event } = yield* setup();
      yield* event("run.updated", WORKER);
      yield* TestClock.adjust(4 * MIN);
      yield* watch.sweep();
      expect(yield* Ref.get(calls)).toEqual([]);
      yield* TestClock.adjust(1 * MIN);
      yield* watch.sweep();
      expect(yield* Ref.get(calls)).toEqual([
        [WORKER, { since: DateTime.formatIso(DateTime.makeUnsafe(START)) }],
      ]);
      // A second look does not flag it again.
      yield* watch.sweep();
      expect(yield* Ref.get(calls)).toHaveLength(1);
    }),
  );

  it.effect("does not count the time a person holds the turn up", () =>
    Effect.gen(function* () {
      const { watch, calls, patch, eventAt } = yield* setup();
      yield* eventAt("run.updated", WORKER, START);
      // A question the turn keeps running past holds the clock, though its status says running.
      yield* patch(WORKER, { pendingRuntimeRequest: {} });
      yield* TestClock.adjust(30 * MIN);
      yield* watch.sweep();
      expect(yield* Ref.get(calls)).toEqual([]);
      // An approval the turn waits on does too.
      yield* patch(WORKER, { pendingRuntimeRequest: { blocking: true }, status: "waiting" });
      yield* TestClock.adjust(30 * MIN);
      yield* watch.sweep();
      expect(yield* Ref.get(calls)).toEqual([]);
      yield* patch(WORKER, { status: "running" });
      // The person answers: the answer is an event, and the silence is counted from it.
      yield* patch(WORKER, { pendingRuntimeRequest: null });
      yield* eventAt("runtime-request.updated", WORKER, START + 60 * MIN);
      yield* TestClock.adjust(4 * MIN);
      yield* watch.sweep();
      expect(yield* Ref.get(calls)).toEqual([]);
      yield* TestClock.adjust(1 * MIN);
      yield* watch.sweep();
      expect(flaggedNow(yield* Ref.get(calls))).toEqual([WORKER]);
    }),
  );

  it.effect("never flags a turn that is not running, and drops the flag when it stops", () =>
    Effect.gen(function* () {
      const { watch, calls, patch, event } = yield* setup();
      yield* event("run.updated", WORKER);
      for (const status of ["queued", "waiting", "completed", "failed", "idle"]) {
        yield* patch(WORKER, { status });
        yield* TestClock.adjust(10 * MIN);
        yield* watch.sweep();
        // A finished worker leaves the watch; the next event brings it back.
        yield* event("run.updated", WORKER);
      }
      expect(yield* Ref.get(calls)).toEqual([]);
      yield* patch(WORKER, { status: "running" });
      yield* TestClock.adjust(6 * MIN);
      yield* watch.sweep();
      expect(flaggedNow(yield* Ref.get(calls))).toEqual([WORKER]);
      yield* patch(WORKER, { status: "completed" });
      yield* watch.sweep();
      expect(yield* Ref.get(calls)).toEqual([
        [WORKER, expect.objectContaining({ since: expect.any(String) })],
        [WORKER, null],
      ]);
    }),
  );

  it.effect("clears the flag at the next event, and its own flag change is not an event", () =>
    Effect.gen(function* () {
      const { watch, calls, event, eventAt } = yield* setup();
      yield* event("run.updated", WORKER);
      yield* TestClock.adjust(6 * MIN);
      yield* watch.sweep();
      expect(flaggedNow(yield* Ref.get(calls))).toEqual([WORKER]);
      // The flag's own thread.metadata-updated event must not count as the worker waking up.
      yield* eventAt("thread.metadata-updated", WORKER, START + 6 * MIN);
      expect(yield* Ref.get(calls)).toHaveLength(1);
      yield* eventAt("turn-item.updated", WORKER, START + 6 * MIN);
      expect(yield* Ref.get(calls)).toEqual([
        [WORKER, expect.anything()],
        [WORKER, null],
      ]);
      // And the silence is counted again from that event.
      yield* TestClock.adjust(4 * MIN);
      yield* watch.sweep();
      expect(yield* Ref.get(calls)).toHaveLength(2);
    }),
  );

  it.effect("watches only workers of a lead, and only ever sets the flag", () =>
    Effect.gen(function* () {
      const plain = ThreadId.make("plain");
      const forked = ThreadId.make("forked");
      const orphan = ThreadId.make("orphan");
      const { watch, calls, event } = yield* setup({
        shells: [
          shellOf({
            id: LEAD,
            lineage: { parentThreadId: null },
            kodoLead: { kind: "sub-agents" },
          }),
          shellOf({ id: plain, lineage: { parentThreadId: null } }),
          shellOf({ id: forked, lineage: { parentThreadId: LEAD, relationshipToParent: "fork" } }),
          // A worker whose parent does not lead (sub-agents were turned off).
          shellOf({
            id: orphan,
            lineage: { parentThreadId: plain, relationshipToParent: "subagent" },
          }),
          shellOf({ id: WORKER }),
        ],
      });
      for (const id of [LEAD, plain, forked, orphan, WORKER]) yield* event("run.updated", id);
      yield* TestClock.adjust(20 * MIN);
      yield* watch.sweep();
      expect(flaggedNow(yield* Ref.get(calls))).toEqual([WORKER]);
      // Everything it did was to set a flag on that worker.
      expect(yield* Ref.get(calls)).toHaveLength(1);
    }),
  );

  it.effect("follows the setting, and turns the flag off with it", () =>
    Effect.gen(function* () {
      const { watch, calls, event, minutes } = yield* setup({ minutes: 10 });
      yield* event("run.updated", WORKER);
      yield* TestClock.adjust(6 * MIN);
      yield* watch.sweep();
      expect(yield* Ref.get(calls)).toEqual([]);
      yield* Ref.set(minutes, 5);
      yield* watch.sweep();
      expect(flaggedNow(yield* Ref.get(calls))).toEqual([WORKER]);
      yield* Ref.set(minutes, 0);
      yield* watch.sweep();
      expect(yield* Ref.get(calls)).toEqual([
        [WORKER, expect.anything()],
        [WORKER, null],
      ]);
    }),
  );

  it.effect("watches workers already running when the server starts, from that moment", () =>
    Effect.gen(function* () {
      const { watch, calls } = yield* setup();
      yield* watch.seed();
      yield* TestClock.adjust(4 * MIN);
      yield* watch.sweep();
      expect(yield* Ref.get(calls)).toEqual([]);
      yield* TestClock.adjust(1 * MIN);
      yield* watch.sweep();
      expect(flaggedNow(yield* Ref.get(calls))).toEqual([WORKER]);
    }),
  );

  it.effect(
    "drops the flag of a worker whose lead stopped leading, and watches it again if it does",
    () =>
      Effect.gen(function* () {
        const { watch, calls, patch, event } = yield* setup();
        yield* event("run.updated", WORKER);
        yield* TestClock.adjust(6 * MIN);
        yield* watch.sweep();
        expect(flaggedNow(yield* Ref.get(calls))).toEqual([WORKER]);
        yield* patch(LEAD, { kodoLead: null });
        yield* watch.sweep();
        expect(yield* Ref.get(calls)).toEqual([
          [WORKER, expect.anything()],
          [WORKER, null],
        ]);
        // The lead is back and the worker speaks, then goes quiet: it is watched like before.
        yield* patch(LEAD, { kodoLead: { kind: "sub-agents" } });
        yield* event("run.updated", WORKER);
        yield* TestClock.adjust(6 * MIN);
        yield* watch.sweep();
        expect(flaggedNow(yield* Ref.get(calls))).toEqual([WORKER, WORKER]);
      }),
  );

  it.effect("clears a flag left on a worker that is no longer running when the server starts", () =>
    Effect.gen(function* () {
      const { watch, calls, patch } = yield* setup();
      yield* patch(WORKER, {
        status: "completed",
        kodoQuiet: { since: "2026-11-14T11:00:00.000Z" },
      });
      yield* watch.seed();
      yield* watch.sweep();
      expect(yield* Ref.get(calls)).toEqual([[WORKER, null]]);
    }),
  );

  it.effect("lets a question the turn keeps running past hold the clock only when it blocks", () =>
    Effect.gen(function* () {
      const { watch, calls, patch, event } = yield* setup();
      yield* event("run.updated", WORKER);
      yield* patch(WORKER, { pendingRuntimeRequest: { blocking: false } });
      yield* TestClock.adjust(6 * MIN);
      yield* watch.sweep();
      expect(flaggedNow(yield* Ref.get(calls))).toEqual([WORKER]);
    }),
  );

  it.effect("does not flag a worker whose event arrives while the sweep is reading", () =>
    Effect.gen(function* () {
      const { watch, calls, event, eventAt, onRead } = yield* setup();
      yield* event("run.updated", WORKER);
      yield* TestClock.adjust(6 * MIN);
      yield* Ref.set(onRead, eventAt("turn-item.updated", WORKER, START + 6 * MIN));
      yield* watch.sweep();
      expect(yield* Ref.get(calls)).toEqual([]);
    }),
  );
});
