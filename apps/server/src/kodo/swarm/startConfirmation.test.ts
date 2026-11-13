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
  kodoStartContentDigest,
  kodoStartRefusalMessage,
  kodoStartRequestRefusal,
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

const baseId = `kodo-start:${input.commandId}:${kodoStartContentDigest(summary)}`;
/** What marks a stored request as the Orchestrator's start question. */
const startRef = { driver: "kodo", nativeId: "start-request" };

const request = (
  over: Partial<OrchestrationV2RuntimeRequest> = {},
): OrchestrationV2RuntimeRequest =>
  ({ id: "any", status: "pending", ...over }) as OrchestrationV2RuntimeRequest;

interface World {
  readonly askBefore?: boolean;
  /** The first read of the thread's requests waits for `readGate`, with what it saw before waiting. */
  readonly gated?: boolean;
  /** The runtime requests the thread already holds, as one read returns them. */
  readonly stored?: ReadonlyArray<OrchestrationV2RuntimeRequest>;
}

const setup = (world: World = {}) =>
  Effect.gen(function* () {
    const recorded = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([]);
    const held = yield* Ref.make<ReadonlyArray<OrchestrationV2RuntimeRequest>>(world.stored ?? []);
    const answer = yield* Deferred.make<OrchestrationV2RuntimeRequest>();
    const waits = yield* Ref.make(0);
    const reads = yield* Ref.make(0);
    const readGate = yield* Deferred.make<void>();
    /** Set once the call is waiting for an answer, so a test acts only when it is. */
    const waiting = yield* Deferred.make<void>();
    const confirmation = makeKodoStartConfirmation({
      askBefore: Effect.succeed(world.askBefore ?? true),
      eventSequence: () => Effect.succeed(7),
      readRequests: () =>
        Effect.gen(function* () {
          const before = yield* Ref.getAndUpdate(reads, (count) => count + 1);
          const seen = yield* Ref.get(held);
          if (world.gated === true && before === 0) yield* Deferred.await(readGate);
          return seen;
        }),
      record: (command) =>
        Ref.update(recorded, (all) => [...all, command]).pipe(
          Effect.andThen(
            command.outcome === "pending"
              ? Ref.update(held, (all) => [
                  ...all,
                  request({ id: command.requestId, nativeRequestRef: startRef } as never),
                ])
              : Effect.void,
          ),
        ),
      settled: () =>
        Ref.update(waits, (count) => count + 1).pipe(
          Effect.andThen(Deferred.succeed(waiting, undefined)),
          Effect.andThen(Deferred.await(answer)),
        ),
      timeout: Duration.minutes(30),
    });
    return { confirmation, recorded, answer, waits, waiting, reads, readGate };
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
      const { confirmation, recorded, answer, waiting } = yield* setup({
        stored: [request({ id: baseId as never })],
      });
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
        const { confirmation, recorded, answer, waiting } = yield* setup({
          stored: [request({ id: baseId, status, decision: "accept" } as never)],
        });
        const fiber = yield* Effect.forkChild(confirmation.confirm(input));
        yield* Deferred.await(waiting);
        const [asked] = yield* Ref.get(recorded);
        expect(asked).toMatchObject({ outcome: "pending", requestId: `${baseId}:1` });
        yield* Deferred.succeed(answer, request({ status: "resolved", decision: "decline" }));
        expect(yield* Fiber.join(fiber)).toBe("declined");
      }),
  );

  it.effect("walks past several answered questions from one read of the thread's requests", () =>
    Effect.gen(function* () {
      const { confirmation, recorded, waiting, reads } = yield* setup({
        stored: [
          request({ id: baseId, status: "resolved" } as never),
          request({ id: `${baseId}:1`, status: "cancelled" } as never),
          request({ id: `${baseId}:2`, status: "expired" } as never),
        ],
      });
      const fiber = yield* Effect.forkChild(confirmation.confirm(input));
      yield* Deferred.await(waiting);
      expect((yield* Ref.get(recorded))[0]).toMatchObject({ requestId: `${baseId}:3` });
      expect(yield* Ref.get(reads)).toBe(1);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect.each([
    {
      name: "another start question is open",
      stored: [request({ id: "kodo-start:other", nativeRequestRef: startRef } as never)],
      expected: "busy",
    },
    {
      name: "only a provider's own approval is open",
      stored: [request({ id: "provider-approval" })],
      expected: "asked",
    },
    {
      name: "the other start question is already answered",
      stored: [
        request({
          id: "kodo-start:other",
          status: "resolved",
          nativeRequestRef: startRef,
        } as never),
      ],
      expected: "asked",
    },
  ])("with $name, the call is $expected", ({ stored, expected }) =>
    Effect.gen(function* () {
      const { confirmation, recorded, waiting, waits } = yield* setup({ stored });
      const fiber = yield* Effect.forkChild(confirmation.confirm(input));
      if (expected === "busy") {
        expect(yield* Fiber.join(fiber)).toBe("busy");
        expect(yield* Ref.get(recorded)).toEqual([]);
        expect(yield* Ref.get(waits)).toBe(0);
      } else {
        yield* Deferred.await(waiting);
        expect(yield* Ref.get(recorded)).toHaveLength(1);
        yield* Fiber.interrupt(fiber);
      }
    }),
  );

  it.effect("two different calls at once raise one question: the other is told to wait", () =>
    Effect.gen(function* () {
      const { confirmation, recorded, readGate } = yield* setup({ gated: true });
      const other = { ...input, summary: { ...summary, request: "Something else." } };
      const first = yield* Effect.forkChild(confirmation.confirm(input));
      const second = yield* Effect.forkChild(confirmation.confirm(other));
      // One yield lets the second call run as far as it can while the first still holds its read.
      yield* Effect.yieldNow;
      yield* Deferred.succeed(readGate, undefined);
      expect(yield* Fiber.join(second)).toBe("busy");
      expect(
        (yield* Ref.get(recorded)).filter((command) => command.outcome === "pending"),
      ).toHaveLength(1);
      yield* Fiber.interrupt(first);
    }),
  );
});

describe("what the card and the refusal say", () => {
  it("carries the whole request, and the fallback it names is the project's default model", () => {
    const long = `${"Add retries to the client. ".repeat(400)}Then push to main.`;
    const card = kodoStartRequestText({ ...summary, request: long });
    expect(card.prompt.endsWith(`Request: ${long}`)).toBe(true);
    expect(card.prompt).toContain("the project's default model");
  });

  it("refuses a request longer than a person can be asked to approve, and no shorter one", () => {
    expect(kodoStartRequestRefusal("x".repeat(32_000))).toBeUndefined();
    expect(kodoStartRequestRefusal("x".repeat(32_001))).toContain("32000");
  });

  it("names the project in every refusal", () => {
    for (const answer of ["declined", "withdrawn", "unanswered"] as const) {
      expect(kodoStartRefusalMessage(answer, "acme-api")).toContain("acme-api");
      expect(kodoStartRefusalMessage(answer, "acme-api")).toContain("Nothing was started");
    }
    expect(kodoStartRefusalMessage("busy", "acme-api")).toContain("Wait for their answer");
  });
});
