// KODO: swarm-delegate - a lead's usage counts every worker it ever had, and says so when it read only the newest.
import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import { makeKodoDelegationUsageReader } from "./usageReader.ts";

const leadId = ThreadId.make("lead");
const select = { instanceId: ProviderInstanceId.make("claude-main"), model: "small" };

const turn = {
  model: "small",
  turnTokenUsage: {
    usageScope: "main_agent",
    usageStatus: "complete",
    hasSubagents: false,
    inputTokens: 1000,
    outputTokens: 100,
  },
};

const setup = (workers: number) =>
  Effect.gen(function* () {
    const shellReads = yield* Ref.make(0);
    const children = Array.from({ length: workers }, (_, index) =>
      ThreadId.make(`worker-${index}`),
    );
    const reader = makeKodoDelegationUsageReader({
      orchestrator: {
        getThreadShell: (threadId: ThreadId) =>
          Ref.update(shellReads, (count) => count + 1).pipe(
            Effect.as({
              id: threadId,
              modelSelection: select,
              createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
            } as never),
          ),
        getThreadRecords: () => Effect.succeed({ providerTurns: [turn] } as never),
        listAppOwnedChildThreadIds: () => Effect.succeed(children),
      } as never,
      price: () => Effect.succeed(0.001),
    });
    return { reader, shellReads };
  });

describe("a lead's usage across all its workers", () => {
  it.effect("counts every worker, reads only the newest, and says the figures are a floor", () =>
    Effect.gen(function* () {
      const { reader, shellReads } = yield* setup(200);
      const usage = yield* reader.read(leadId);
      // One lead read, and the newest 64 workers: not 200 more.
      expect(yield* Ref.get(shellReads)).toBe(65);
      expect(usage.workerCount).toBe(200);
      expect(usage.workers).toMatchObject({ complete: false });
    }),
  );

  it.effect("is exact when every worker was read", () =>
    Effect.gen(function* () {
      const { reader } = yield* setup(10);
      const usage = yield* reader.read(leadId);
      expect(usage.workerCount).toBe(10);
      expect(usage.workers).toMatchObject({ complete: true });
    }),
  );
});
