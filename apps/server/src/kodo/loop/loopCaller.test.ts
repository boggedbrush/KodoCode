import { describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { callerRunsLoop } from "./loopCaller.ts";

const id = (name: string) => ThreadId.make(name);

const shell = (over: {
  status?: "active" | "held" | "done" | "stopped";
  parent?: string;
  delegatedFrom?: string;
}) => ({
  ...(over.status === undefined ? {} : { kodoLoopStatus: { status: over.status } }),
  lineage: { parentThreadId: over.parent === undefined ? null : id(over.parent) },
  ...(over.delegatedFrom === undefined
    ? {}
    : { delegatedFrom: { threadId: id(over.delegatedFrom) } }),
});

const lookup = (threads: Record<string, ReturnType<typeof shell>>) => (threadId: ThreadId) =>
  Effect.succeed(threads[threadId] ?? null);

describe("whether the thread a request came from is running a loop", () => {
  it.effect.each([
    ["its own loop is active", { a: shell({ status: "active" }) }, true],
    ["its own loop waits for approval", { a: shell({ status: "held" }) }, true],
    ["its own loop ended", { a: shell({ status: "done" }) }, false],
    ["it has no loop", { a: shell({}) }, false],
    ["the thread is unknown", {}, false],
    [
      "the parent it was forked from runs one",
      { a: shell({ parent: "p" }), p: shell({ status: "active" }) },
      true,
    ],
    [
      "the thread that delegated to it runs one",
      { a: shell({ delegatedFrom: "d" }), d: shell({ status: "active" }) },
      true,
    ],
    [
      "a grandparent runs one",
      { a: shell({ parent: "p" }), p: shell({ parent: "g" }), g: shell({ status: "held" }) },
      true,
    ],
    [
      "parents loop back on themselves and none runs a loop",
      { a: shell({ parent: "p" }), p: shell({ parent: "a" }) },
      false,
    ],
  ] as const)("is %s: %s", ([_name, threads, expected]) =>
    Effect.gen(function* () {
      expect(yield* callerRunsLoop(lookup(threads as never), id("a"))).toBe(expected);
    }),
  );
});
