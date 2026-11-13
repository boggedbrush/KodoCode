// KODO: swarm-delegate - the gate on the Orchestrator starting work: asked of a person, answered by one, and never by the model.
import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  type OrchestrationV2RuntimeRequest,
  NodeId,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";

import {
  kodoStartRefusalMessage,
  kodoStartRequestText,
  makeKodoStartConfirmation,
} from "./startConfirmation.ts";

const threadId = ThreadId.make("kodo-orchestrator");
const requestId = RuntimeRequestId.make("kodo-start:command:1");
const summary = {
  projectTitle: "acme-api",
  projectId: "project-acme-api",
  mode: "code",
  model: "slot-model",
  request: "Add retries to src/http.ts.",
};
const input = {
  threadId,
  runId: RunId.make("run:1"),
  rootNodeId: NodeId.make("node:root"),
  requestId,
  commandId: CommandId.make("command:1"),
  summary,
};

const request = (
  over: Partial<OrchestrationV2RuntimeRequest> = {},
): OrchestrationV2RuntimeRequest =>
  ({ id: requestId, status: "pending", ...over }) as OrchestrationV2RuntimeRequest;

interface World {
  readonly askBefore?: boolean;
  /** The request as stored before the call, when a retry finds one. */
  readonly existing?: OrchestrationV2RuntimeRequest;
}

const setup = (world: World = {}) =>
  Effect.gen(function* () {
    const recorded = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([]);
    const answer = yield* Deferred.make<OrchestrationV2RuntimeRequest>();
    const waits = yield* Ref.make(0);
    /** Set once the call is waiting for an answer, so a test acts only when it is. */
    const waiting = yield* Deferred.make<void>();
    const confirmation = makeKodoStartConfirmation({
      askBefore: Effect.succeed(world.askBefore ?? true),
      eventSequence: () => Effect.succeed(7),
      readRequest: () => Effect.succeed(world.existing),
      record: (command) => Ref.update(recorded, (all) => [...all, command]),
      settled: () =>
        Ref.update(waits, (count) => count + 1).pipe(
          Effect.andThen(Deferred.succeed(waiting, undefined)),
          Effect.andThen(Deferred.await(answer)),
        ),
      timeout: Duration.minutes(30),
    });
    return { confirmation, recorded, answer, waits, waiting };
  });

describe("asking before the Orchestrator starts work", () => {
  it.effect("does not ask, or wait, when the setting is off", () =>
    Effect.gen(function* () {
      const { confirmation, recorded, waits } = yield* setup({ askBefore: false });
      expect(yield* confirmation.confirm(input)).toBe("not-asked");
      expect(yield* Ref.get(recorded)).toEqual([]);
      expect(yield* Ref.get(waits)).toBe(0);
    }),
  );

  it.effect(
    "raises one pending question naming the project, mode, model and request, and starts on approval",
    () =>
      Effect.gen(function* () {
        const { confirmation, recorded, answer, waiting } = yield* setup();
        const fiber = yield* Effect.forkChild(confirmation.confirm(input));
        yield* Deferred.await(waiting);
        const [asked, ...rest] = yield* Ref.get(recorded);
        expect(rest).toEqual([]);
        expect(asked).toMatchObject({
          type: "kodo.start-request.record",
          outcome: "pending",
          threadId,
          requestId,
          nodeId: "node:root",
          commandId: "command:1:kodo-start:pending",
        });
        for (const part of ["acme-api", "project-acme-api", "Code", "slot-model", "Add retries"]) {
          expect(String(asked?.prompt)).toContain(part);
        }
        yield* Deferred.succeed(answer, request({ status: "resolved", decision: "accept" }));
        expect(yield* Fiber.join(fiber)).toBe("approved");
        expect(yield* Ref.get(recorded)).toHaveLength(1);
      }),
  );

  it.effect.each([
    {
      name: "a decline",
      stored: { status: "resolved", decision: "decline" },
      expected: "declined",
    },
    { name: "a cancel", stored: { status: "resolved", decision: "cancel" }, expected: "declined" },
    {
      name: "a question that was cancelled",
      stored: { status: "cancelled" },
      expected: "withdrawn",
    },
    { name: "a question that expired", stored: { status: "expired" }, expected: "withdrawn" },
  ] as const)("$name starts nothing", ({ stored, expected }) =>
    Effect.gen(function* () {
      const { confirmation, answer, waiting } = yield* setup();
      const fiber = yield* Effect.forkChild(confirmation.confirm(input));
      yield* Deferred.await(waiting);
      yield* Deferred.succeed(answer, request(stored as never));
      expect(yield* Fiber.join(fiber)).toBe(expected);
    }),
  );

  it.effect("withdraws the question when the call is stopped, so it does not outlive it", () =>
    Effect.gen(function* () {
      const { confirmation, recorded, waiting } = yield* setup();
      const fiber = yield* Effect.forkChild(confirmation.confirm(input));
      yield* Deferred.await(waiting);
      yield* Fiber.interrupt(fiber);
      expect((yield* Ref.get(recorded)).map((command) => command.outcome)).toEqual([
        "pending",
        "cancelled",
      ]);
    }),
  );

  it.effect("gives up unanswered after the wait, and withdraws the question", () =>
    Effect.gen(function* () {
      const { confirmation, recorded, waiting } = yield* setup();
      const fiber = yield* Effect.forkChild(confirmation.confirm(input));
      yield* Deferred.await(waiting);
      yield* TestClock.adjust(Duration.minutes(31));
      expect(yield* Fiber.join(fiber)).toBe("unanswered");
      expect((yield* Ref.get(recorded)).map((command) => command.outcome)).toEqual([
        "pending",
        "cancelled",
      ]);
    }),
  );

  it.effect(
    "a retry of the same call finds its question: it asks nothing new, and takes an answer already given",
    () =>
      Effect.gen(function* () {
        const pending = yield* setup({ existing: request() });
        const fiber = yield* Effect.forkChild(pending.confirmation.confirm(input));
        yield* Deferred.await(pending.waiting);
        yield* Deferred.succeed(
          pending.answer,
          request({ status: "resolved", decision: "accept" }),
        );
        expect(yield* Fiber.join(fiber)).toBe("approved");
        expect(yield* Ref.get(pending.recorded)).toEqual([]);

        const answered = yield* setup({
          existing: request({ status: "resolved", decision: "decline" }),
        });
        expect(yield* answered.confirmation.confirm(input)).toBe("declined");
        expect(yield* Ref.get(answered.waits)).toBe(0);
      }),
  );
});

describe("what the card and the refusal say", () => {
  it("keeps a long request to a bounded card and names the project in every refusal", () => {
    const long = kodoStartRequestText({ ...summary, request: "x".repeat(5000) });
    expect(long.prompt.length).toBeLessThan(1800);
    expect(long.prompt).toContain("...");
    for (const answer of ["declined", "withdrawn", "unanswered"] as const) {
      expect(kodoStartRefusalMessage(answer, "acme-api")).toContain("acme-api");
      expect(kodoStartRefusalMessage(answer, "acme-api")).toContain("Nothing was started");
    }
  });
});
