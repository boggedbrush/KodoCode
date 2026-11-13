// KODO: swarm-delegate - the gate on the Orchestrator starting work: asked of a person, answered by one, and never by the model.
import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  type OrchestrationV2RuntimeRequest,
  NodeId,
  RunId,
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
const summary = {
  projectTitle: "acme-api",
  projectId: "project-acme-api",
  mode: "code",
  request: "Add retries to src/http.ts.",
};
const input = {
  threadId,
  runId: RunId.make("run:1"),
  rootNodeId: NodeId.make("node:root"),
  commandId: CommandId.make("command:1"),
  summary,
};

const request = (
  over: Partial<OrchestrationV2RuntimeRequest> = {},
): OrchestrationV2RuntimeRequest =>
  ({ id: "any", status: "pending", ...over }) as OrchestrationV2RuntimeRequest;

interface World {
  readonly askBefore?: boolean;
  /** What each successive read for a question finds: the first id, then the next, and so on. */
  readonly stored?: ReadonlyArray<OrchestrationV2RuntimeRequest | undefined>;
}

const setup = (world: World = {}) =>
  Effect.gen(function* () {
    const recorded = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([]);
    const answer = yield* Deferred.make<OrchestrationV2RuntimeRequest>();
    const waits = yield* Ref.make(0);
    const reads = yield* Ref.make<ReadonlyArray<string>>([]);
    /** Set once the call is waiting for an answer, so a test acts only when it is. */
    const waiting = yield* Deferred.make<void>();
    const confirmation = makeKodoStartConfirmation({
      askBefore: Effect.succeed(world.askBefore ?? true),
      eventSequence: () => Effect.succeed(7),
      readRequest: (_, id) =>
        Ref.modify(reads, (all) => [world.stored?.[all.length], [...all, id]] as const),
      record: (command) => Ref.update(recorded, (all) => [...all, command]),
      settled: () =>
        Ref.update(waits, (count) => count + 1).pipe(
          Effect.andThen(Deferred.succeed(waiting, undefined)),
          Effect.andThen(Deferred.await(answer)),
        ),
      timeout: Duration.minutes(30),
    });
    return { confirmation, recorded, answer, waits, waiting, reads };
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
          nodeId: "node:root",
        });
        expect(String(asked?.requestId)).toMatch(/^kodo-start:command:1:[0-9a-f]{24}$/);
        expect(asked?.commandId).toBe(`${String(asked?.requestId)}:record:pending`);
        for (const part of ["acme-api", "project-acme-api", "Code", "Add retries"]) {
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

  it.effect("a duplicate call joins the question still pending and asks nothing new", () =>
    Effect.gen(function* () {
      const { confirmation, recorded, answer, waiting } = yield* setup({ stored: [request()] });
      const fiber = yield* Effect.forkChild(confirmation.confirm(input));
      yield* Deferred.await(waiting);
      yield* Deferred.succeed(answer, request({ status: "resolved", decision: "accept" }));
      expect(yield* Fiber.join(fiber)).toBe("approved");
      expect(yield* Ref.get(recorded)).toEqual([]);
    }),
  );

  it.effect.each(["resolved", "cancelled", "expired"] as const)(
    "a %s question under the same id is not replayed: the call asks again under a new one",
    (status) =>
      Effect.gen(function* () {
        const { confirmation, recorded, answer, waiting, reads } = yield* setup({
          stored: [request({ status, decision: "accept" } as never)],
        });
        const fiber = yield* Effect.forkChild(confirmation.confirm(input));
        yield* Deferred.await(waiting);
        const [first, second] = yield* Ref.get(reads);
        expect(second).toBe(`${first}:1`);
        const [asked] = yield* Ref.get(recorded);
        expect(asked).toMatchObject({ outcome: "pending", requestId: second });
        yield* Deferred.succeed(answer, request({ status: "resolved", decision: "decline" }));
        expect(yield* Fiber.join(fiber)).toBe("declined");
      }),
  );

  it.effect("the same call with other content is another question", () =>
    Effect.gen(function* () {
      const ids = new Set<string>();
      for (const changed of [
        {},
        { projectId: "project-other" },
        { request: "Something else." },
        { mode: "review" },
      ]) {
        const { confirmation, recorded, waiting } = yield* setup();
        const fiber = yield* Effect.forkChild(
          confirmation.confirm({ ...input, summary: { ...summary, ...changed } }),
        );
        yield* Deferred.await(waiting);
        ids.add(String((yield* Ref.get(recorded))[0]?.requestId));
        yield* Fiber.interrupt(fiber);
      }
      expect(ids.size).toBe(4);
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
