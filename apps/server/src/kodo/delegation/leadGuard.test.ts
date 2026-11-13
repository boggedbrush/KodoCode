import { describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";

import {
  type KodoLeadShell,
  kodoGuardThreadStart,
  kodoGuardWorkerMessaging,
  kodoGuardWorkerStart,
  kodoThreadRunsUnder,
  kodoThreadUnderLead,
  makeKodoLeadLocks,
} from "./leadGuard.ts";

const id = (name: string) => ThreadId.make(name);
const at = (seconds: number) => DateTime.makeUnsafe(1_700_000_000_000 + seconds * 1000);

interface Fixture {
  lead?: boolean;
  parent?: string;
  relationship?: "subagent" | "fork";
  delegatedFrom?: string;
  /** A live worker: its run is going. */
  live?: boolean;
  createdAt?: number;
  turnStartedAt?: number;
  deleted?: boolean;
}

const shell = (name: string, f: Fixture = {}): KodoLeadShell =>
  ({
    id: id(name),
    ...(f.lead ? { kodoLead: { kind: "sub-agents" } } : {}),
    lineage: {
      parentThreadId: f.parent === undefined ? null : id(f.parent),
      relationshipToParent: f.parent === undefined ? null : (f.relationship ?? "subagent"),
    },
    ...(f.delegatedFrom === undefined ? {} : { delegatedFrom: { threadId: id(f.delegatedFrom) } }),
    status: f.live ? "running" : "idle",
    activityRunStatus: f.live ? "running" : null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    createdAt: at(f.createdAt ?? 0),
    deletedAt: f.deleted ? at(1) : null,
    activityRunStartedAt: f.turnStartedAt === undefined ? null : at(f.turnStartedAt),
    latestRunRequestedAt: null,
  }) as unknown as KodoLeadShell;

const world = (threads: Record<string, Fixture>) => {
  const shells = Object.fromEntries(
    Object.entries(threads).map(([name, f]) => [name, shell(name, f)]),
  );
  return {
    getShell: (threadId: ThreadId) => Effect.succeed(shells[threadId] ?? null),
    listChildIds: (leadId: ThreadId) =>
      Effect.succeed(
        Object.entries(threads)
          .filter(([, f]) => f.parent === leadId && f.relationship !== "fork")
          .map(([name]) => id(name)),
      ),
    toMillis: DateTime.toEpochMillis,
    maxWorkersSetting: Effect.succeed<unknown>(3),
  };
};

describe("whether a thread is a worker of a lead", () => {
  it.effect.each([
    ["a delegated child of a lead", { lead: { lead: true }, w: { parent: "lead" } }, "w", true],
    [
      "a grandchild: a worker's own child",
      { lead: { lead: true }, w: { parent: "lead" }, x: { parent: "w" } },
      "x",
      true,
    ],
    [
      "a task delegated from a lead in a linked environment",
      { lead: { lead: true }, w: { delegatedFrom: "lead" } },
      "w",
      true,
    ],
    [
      "a fork of a lead: not a worker",
      { lead: { lead: true }, f: { parent: "lead", relationship: "fork" } },
      "f",
      false,
    ],
    ["the lead itself", { lead: { lead: true } }, "lead", false],
    ["a delegated child of a thread that is not a lead", { p: {}, w: { parent: "p" } }, "w", false],
    ["a thread nobody knows", {}, "ghost", false],
    [
      "parents that loop back on themselves",
      { a: { parent: "b" }, b: { parent: "a" } },
      "a",
      false,
    ],
  ] as const)("is %s: %s", ([_name, threads, thread, expected]) =>
    Effect.gen(function* () {
      expect(yield* kodoThreadUnderLead(world(threads as never).getShell, id(thread))).toBe(
        expected,
      );
    }),
  );

  it.effect("reads a bounded depth: a chain longer than the bound is not walked to the end", () =>
    Effect.gen(function* () {
      const chain: Record<string, Fixture> = { lead: { lead: true } };
      let previous = "lead";
      for (let n = 1; n <= 10; n += 1) {
        chain[`t${n}`] = { parent: previous };
        previous = `t${n}`;
      }
      expect(yield* kodoThreadUnderLead(world(chain).getShell, id("t3"))).toBe(true);
      expect(yield* kodoThreadUnderLead(world(chain).getShell, id("t10"))).toBe(false);
    }),
  );

  it.effect(
    "says whether a thread is, or runs under, another by any link, for the sender check",
    () =>
      Effect.gen(function* () {
        const w = world({
          lead: {},
          w: { parent: "lead" },
          f: { parent: "lead", relationship: "fork" },
          o: {},
        });
        expect(yield* kodoThreadRunsUnder(w.getShell, id("lead"), id("lead"))).toBe(true);
        expect(yield* kodoThreadRunsUnder(w.getShell, id("w"), id("lead"))).toBe(true);
        expect(yield* kodoThreadRunsUnder(w.getShell, id("f"), id("lead"))).toBe(true);
        expect(yield* kodoThreadRunsUnder(w.getShell, id("lead"), id("w"))).toBe(false);
        expect(yield* kodoThreadRunsUnder(w.getShell, id("o"), id("lead"))).toBe(false);
      }),
  );
});

const guard = (w: ReturnType<typeof world>, caller: string, adding = 1) =>
  kodoGuardWorkerStart(w, { callerThreadId: id(caller), adding }).pipe(
    Effect.map(() => "allowed" as const),
    Effect.catch((error) => Effect.succeed(error.message)),
  );

const threadStart = (w: ReturnType<typeof world>, caller: string) =>
  kodoGuardThreadStart(w, id(caller)).pipe(
    Effect.map(() => "allowed" as const),
    Effect.catch((error) => Effect.succeed(error.message)),
  );

describe("starting work from a thread", () => {
  it.effect("refuses a worker, whatever it tries to start", () =>
    Effect.gen(function* () {
      const w = world({ lead: { lead: true }, w: { parent: "lead" } });
      expect(yield* guard(w, "w")).toMatch(/workers do not start workers, threads or loops/);
      expect(yield* threadStart(w, "w")).toMatch(/workers do not start/);
    }),
  );

  it.effect(
    "refuses create_threads and t3_thread_launch from a lead, and leaves other threads alone",
    () =>
      Effect.gen(function* () {
        const w = world({ lead: { lead: true }, p: {}, gone: { parent: "p" } });
        expect(yield* threadStart(w, "lead")).toMatch(/does not create or launch other threads/);
        expect(yield* threadStart(w, "lead")).toMatch(/delegate_task/);
        expect(yield* threadStart(w, "p")).toBe("allowed");
        expect(yield* threadStart(w, "nobody")).toBe("allowed");
      }),
  );

  it.effect("refuses a worker's fork and send, and nobody else's", () =>
    Effect.gen(function* () {
      const w = world({ lead: { lead: true }, w: { parent: "lead" }, p: {} });
      const messaging = (caller: string) =>
        kodoGuardWorkerMessaging(w, id(caller)).pipe(
          Effect.map(() => "allowed" as const),
          Effect.catch((error) => Effect.succeed(error.message)),
        );
      expect(yield* messaging("w")).toMatch(/does not fork itself or send messages/);
      expect(yield* messaging("lead")).toBe("allowed");
      expect(yield* messaging("p")).toBe("allowed");
    }),
  );

  it.effect("leaves a thread that is neither a lead nor a worker alone, caps and all", () =>
    Effect.gen(function* () {
      const w = world({
        p: {},
        a: { parent: "p" },
        b: { parent: "p" },
        c: { parent: "p" },
        d: { parent: "p" },
      });
      expect(yield* guard(w, "p", 5)).toBe("allowed");
    }),
  );

  it.effect("lets a lead start workers up to the live cap and refuses the next", () =>
    Effect.gen(function* () {
      const two = world({
        lead: { lead: true },
        a: { parent: "lead", live: true },
        b: { parent: "lead", live: true },
        done: { parent: "lead" },
      });
      expect(yield* guard(two, "lead")).toBe("allowed");
      const three = world({
        lead: { lead: true },
        a: { parent: "lead", live: true },
        b: { parent: "lead", live: true },
        c: { parent: "lead", live: true },
      });
      expect(yield* guard(three, "lead")).toMatch(/3 of 3 workers are still running/);
    }),
  );

  it.effect("reads the cap from the setting, up to six", () =>
    Effect.gen(function* () {
      const live: Record<string, Fixture> = { lead: { lead: true } };
      for (let n = 1; n <= 5; n += 1) live[`w${n}`] = { parent: "lead", live: true };
      expect(yield* guard({ ...world(live), maxWorkersSetting: Effect.succeed(6) }, "lead")).toBe(
        "allowed",
      );
      expect(
        yield* guard({ ...world(live), maxWorkersSetting: Effect.succeed(99) }, "lead", 2),
      ).toMatch(/going over|over the limit/);
    }),
  );

  it.effect("counts a batch as a whole and does not count a deleted worker", () =>
    Effect.gen(function* () {
      const w = world({
        lead: { lead: true },
        a: { parent: "lead", live: true },
        gone: { parent: "lead", live: true, deleted: true },
      });
      expect(yield* guard(w, "lead", 2)).toBe("allowed");
      expect(yield* guard(w, "lead", 3)).toMatch(/3 more/);
    }),
  );

  it.effect(
    "stops a turn at eight workers though none is live, and starts counting again next turn",
    () =>
      Effect.gen(function* () {
        const finished: Record<string, Fixture> = { lead: { lead: true, turnStartedAt: 100 } };
        for (let n = 1; n <= 8; n += 1) finished[`w${n}`] = { parent: "lead", createdAt: 100 + n };
        expect(
          yield* guard({ ...world(finished), maxWorkersSetting: Effect.succeed(6) }, "lead"),
        ).toMatch(/8 is the most/);
        // The same workers belong to an earlier turn once the lead's turn began after them.
        finished.lead = { lead: true, turnStartedAt: 200 };
        expect(
          yield* guard({ ...world(finished), maxWorkersSetting: Effect.succeed(6) }, "lead"),
        ).toBe("allowed");
      }),
  );

  it.effect("refuses, rather than allows, when its reads fail", () =>
    Effect.gen(function* () {
      const w = world({ lead: { lead: true } });
      const failing = {
        ...w,
        listChildIds: () => Effect.fail({ _tag: "ProjectionStoreReadError" }),
      };
      expect(yield* guard(failing as never, "lead")).toMatch(
        /could not be checked, so nothing was started/,
      );
      const noShell = { ...w, getShell: () => Effect.fail({ _tag: "ProjectionStoreReadError" }) };
      expect(yield* guard(noShell as never, "lead")).toMatch(/could not be checked/);
    }),
  );
});

describe("the lead's lock", () => {
  it.effect("hands over to the next holder when the first gives it back, once", () =>
    Effect.gen(function* () {
      const locks = makeKodoLeadLocks();
      const scopeA = yield* Scope.make();
      const scopeB = yield* Scope.make();
      const giveBackA = yield* locks.hold("lead").pipe(Scope.provide(scopeA));
      // Another lead is not held up by this one.
      yield* locks.hold("other").pipe(Effect.scoped, Effect.asVoid);
      const acquiredB = yield* Deferred.make<void>();
      yield* locks.hold("lead").pipe(
        Scope.provide(scopeB),
        Effect.tap(() => Deferred.succeed(acquiredB, undefined)),
        Effect.forkChild,
      );
      yield* giveBackA;
      yield* Deferred.await(acquiredB);
      // Giving back again, and closing the first scope, must not give back the second holder's lock.
      yield* giveBackA;
      yield* Scope.close(scopeA, Exit.void);
      expect(locks.size()).toBe(1);
      yield* Scope.close(scopeB, Exit.void);
      expect(locks.size()).toBe(0);
    }),
  );

  it.effect("gives the lock back when its scope closes without an explicit give-back", () =>
    Effect.gen(function* () {
      const locks = makeKodoLeadLocks();
      yield* locks.hold("lead").pipe(Effect.scoped, Effect.asVoid);
      yield* locks.hold("lead").pipe(Effect.scoped, Effect.asVoid);
      expect(locks.size()).toBe(0);
    }),
  );
});
