// KODO: delegation-instructions - the held spend of a lead: read once, read again when its turns end.
import { describe, expect, it } from "@effect/vitest";
import {
  ThreadId,
  type KodoDelegationUsage,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import { makeKodoLeadSpendCache } from "./leadSpendCache.ts";

const LEAD = ThreadId.make("lead");
const WORKER = ThreadId.make("worker");
const OTHER = ThreadId.make("other");

const usageOf = (tokens: number): KodoDelegationUsage => ({
  threadId: LEAD,
  lead: { tokens, complete: true },
  workerCount: 1,
  unreportedWorkers: 0,
});

const event = (type: string, threadId: ThreadId, status?: string) =>
  ({ type, threadId, payload: { status } }) as unknown as OrchestrationV2DomainEvent;

const setup = Effect.gen(function* () {
  const reads = yield* Ref.make(0);
  const cache = makeKodoLeadSpendCache({
    read: (leadId) =>
      Ref.updateAndGet(reads, (count) => count + 1).pipe(
        Effect.map((count) =>
          leadId === LEAD ? { usage: usageOf(count * 1000), threadIds: [WORKER] } : undefined,
        ),
      ),
  });
  return { cache, reads };
});

describe("the held spend of a lead", () => {
  it.effect("reads once, then serves the held figure without reading again", () =>
    Effect.gen(function* () {
      const { cache, reads } = yield* setup;
      expect((yield* cache.get(LEAD))?.lead?.tokens).toBe(1000);
      expect((yield* cache.get(LEAD))?.lead?.tokens).toBe(1000);
      expect(yield* Ref.get(reads)).toBe(1);
      expect(yield* cache.get(OTHER)).toBeUndefined();
    }),
  );

  it.effect("reads again in the background when a turn of the lead or a worker ends", () =>
    Effect.gen(function* () {
      const { cache, reads } = yield* setup;
      yield* cache.get(LEAD);
      // Streaming, a thread that is not the lead's, and a turn still running change nothing.
      yield* cache.noteEvent(event("provider-turn.updated", WORKER, "running"));
      yield* cache.noteEvent(event("provider-turn.updated", OTHER, "completed"));
      yield* cache.noteEvent(event("run.updated", WORKER, "completed"));
      expect(yield* Ref.get(reads)).toBe(1);
      yield* cache.noteEvent(event("provider-turn.updated", WORKER, "completed"));
      yield* cache.settled;
      expect((yield* cache.get(LEAD))?.lead?.tokens).toBe(2000);
    }),
  );

  it.effect("reads again when the lead's worker list changes", () =>
    Effect.gen(function* () {
      const { cache } = yield* setup;
      yield* cache.get(LEAD);
      yield* cache.noteEvent(event("subagent.updated", LEAD));
      yield* cache.settled;
      expect((yield* cache.get(LEAD))?.lead?.tokens).toBe(2000);
    }),
  );
});
