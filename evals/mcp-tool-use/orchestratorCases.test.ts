// @effect-diagnostics nodeBuiltinImport:off
// KODO: orchestrator-eval - the Orchestrator's cases decode against the case schema, so a typo in one is
// caught in CI even though the cases themselves need provider keys to run.
import * as NodeFS from "node:fs";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { KODO_ORCHESTRATOR_TOOLS } from "../../apps/server/src/kodo/swarm/swarmAllowlist.ts";
import { McpToolUseCase } from "./run.ts";

const decode = Schema.decodeSync(Schema.fromJsonString(McpToolUseCase));
const cases = NodeFS.readFileSync(new URL("./cases/orchestrator.ndjson", import.meta.url), "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => decode(line));

describe("the Orchestrator's eval cases", () => {
  it("decode, are the Orchestrator's, and have unique ids", () => {
    expect(cases.length).toBeGreaterThan(0);
    expect(new Set(cases.map((testCase) => testCase.id)).size).toBe(cases.length);
    for (const testCase of cases) expect(testCase.setup.kodoOrchestrator, testCase.id).toBe(true);
  });

  it("only mock tools the Orchestrator can call", () => {
    for (const testCase of cases) {
      for (const tool of Object.keys(testCase.setup.mocks ?? {})) {
        expect(KODO_ORCHESTRATOR_TOOLS.has(tool), `${testCase.id}: ${tool}`).toBe(true);
      }
    }
  });
});
