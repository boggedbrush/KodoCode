import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { affectsLoop, isTrackedLoopEvent } from "./loopEvents.ts";
import { makeThreadSingleFlight } from "./threadSingleFlight.ts";

it.effect(
  "a look asked for during a look does not queue behind it; the look runs at most twice",
  () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      let started = 0;
      const look = makeThreadSingleFlight((_key: string) =>
        Effect.gen(function* () {
          started += 1;
          if (started === 1) yield* Deferred.await(gate);
          return started;
        }),
      );
      const first = yield* Effect.forkChild(look("thread-a"));
      yield* Effect.yieldNow;
      // A burst of events while the first look is in flight: each returns at once.
      for (let index = 0; index < 50; index += 1) {
        assert.isUndefined(yield* look("thread-a"));
      }
      // Another thread is not held up by it.
      assert.equal(yield* look("thread-b"), 2);
      yield* Deferred.succeed(gate, undefined);
      assert.equal(yield* Fiber.join(first), 3, "one more look, however many events arrived");
      assert.equal(started, 3);
    }),
);

const event = (type: string, payload: object) => ({ type, threadId: "t", payload }) as never;

it("only events that can change a loop's next step are looked at, and streaming text is not one", () => {
  const assistant = (streaming: boolean) =>
    event("message.updated", { role: "assistant", streaming, text: "..." });
  assert.isFalse(affectsLoop(assistant(true)), "every streaming snapshot is ignored");
  assert.isTrue(affectsLoop(assistant(false)), "a reply settling is not");
  assert.isFalse(affectsLoop(event("message.updated", { role: "user", streaming: false })));
  assert.isFalse(affectsLoop(event("plan.updated", { status: "draft" })));
  assert.isTrue(affectsLoop(event("plan.updated", { status: "active" })));
  assert.isFalse(affectsLoop(event("turn-item.updated", { type: "assistant_message" })));
  assert.isFalse(affectsLoop(event("turn-item.updated", { type: "command_execution" })));
  assert.isTrue(affectsLoop(event("turn-item.updated", { type: "error" })));
  for (const type of [
    "run.created",
    "run.updated",
    "thread.metadata-updated",
    "thread.interaction-mode-updated",
    "runtime-request.updated",
  ]) {
    assert.isTrue(affectsLoop(event(type, {})), type);
  }
  for (const type of [
    "thread.visited",
    "thread.pinned",
    "provider-turn.updated",
    "checkpoint.updated",
  ]) {
    assert.isFalse(affectsLoop(event(type, {})), type);
  }
});

it("a loop is tracked while it runs and while its clean-up is owed", () => {
  const meta = (kodoLoop: object | undefined) => event("thread.metadata-updated", { kodoLoop });
  assert.isTrue(isTrackedLoopEvent(meta({ status: "active" })));
  assert.isTrue(isTrackedLoopEvent(meta({ status: "held" })));
  assert.isTrue(isTrackedLoopEvent(meta({ status: "stopped", cleanup: { interrupt: true } })));
  assert.isFalse(isTrackedLoopEvent(meta({ status: "done" })));
  assert.isFalse(isTrackedLoopEvent(meta(undefined)));
});
