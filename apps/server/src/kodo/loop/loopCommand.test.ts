import { describe, expect, it } from "@effect/vitest";
import { KODO_LOOP_MAX_ROUNDS, KODO_LOOP_REQUEST_MAX_CHARS } from "@t3tools/contracts";

import { parseLoopCommand } from "./loopCommand.ts";

describe("parseLoopCommand", () => {
  it.each([
    [
      "/loop fix the flaky test",
      { type: "start", request: "fix the flaky test", maxRounds: undefined },
    ],
    [
      "  /loop   fix the flaky test  ",
      { type: "start", request: "fix the flaky test", maxRounds: undefined },
    ],
    ["/LOOP fix it", { type: "start", request: "fix it", maxRounds: undefined }],
    ["/loop 5 fix the flaky test", { type: "start", request: "fix the flaky test", maxRounds: 5 }],
    [
      `/loop ${KODO_LOOP_MAX_ROUNDS} x`,
      { type: "start", request: "x", maxRounds: KODO_LOOP_MAX_ROUNDS },
    ],
    ["/loop 1 x", { type: "start", request: "x", maxRounds: 1 }],
    ["/loop 007 x", { type: "start", request: "x", maxRounds: 7 }],
    [
      "/loop make it work\nthen add tests\n\nkeep the API",
      {
        type: "start",
        request: "make it work\nthen add tests\n\nkeep the API",
        maxRounds: undefined,
      },
    ],
    [
      "/loop 3\nrefactor the parser",
      { type: "start", request: "refactor the parser", maxRounds: 3 },
    ],
    [
      "/loop 2fa tokens expire early",
      { type: "start", request: "2fa tokens expire early", maxRounds: undefined },
    ],
    ["/loop stop", { type: "stop" }],
    ["/loop STOP ", { type: "stop" }],
    ["/loop status", { type: "status" }],
    [
      "/loop stop the flaky test from failing",
      { type: "start", request: "stop the flaky test from failing", maxRounds: undefined },
    ],
    ["/loop 2 stop", { type: "start", request: "stop", maxRounds: 2 }],
  ])("reads %j", (text, expected) => {
    expect(parseLoopCommand(text)).toEqual(expected);
  });

  it.each([
    ["an ordinary prompt", "please loop over the list"],
    ["a slash command that merely starts the same", "/loops are great"],
    ["a hyphenated command", "/loop-now fix it"],
    ["the command not at the start", "run /loop fix it"],
    ["an empty message", ""],
  ])("passes %s through", (_name, text) => {
    expect(parseLoopCommand(text)).toBeNull();
  });

  it.each([
    ["no request", "/loop"],
    ["only blanks", "/loop   "],
    ["rounds without a request", "/loop 3"],
    ["zero rounds", "/loop 0 fix it"],
    ["too many rounds", `/loop ${KODO_LOOP_MAX_ROUNDS + 1} fix it`],
    ["a rounds count too large to be a number", `/loop ${"9".repeat(30)} fix it`],
    ["a request over the cap", `/loop ${"x".repeat(KODO_LOOP_REQUEST_MAX_CHARS + 1)}`],
  ])("rejects %s with a message", (_name, text) => {
    const parsed = parseLoopCommand(text);
    expect(parsed?.type).toBe("invalid");
    if (parsed?.type === "invalid") expect(parsed.message.length).toBeGreaterThan(0);
  });

  it("accepts a request exactly at the cap", () => {
    const request = "x".repeat(KODO_LOOP_REQUEST_MAX_CHARS);
    expect(parseLoopCommand(`/loop ${request}`)).toEqual({
      type: "start",
      request,
      maxRounds: undefined,
    });
  });
});
