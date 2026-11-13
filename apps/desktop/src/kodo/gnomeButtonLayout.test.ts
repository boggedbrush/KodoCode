import { describe, expect, it } from "vite-plus/test";

import { parseGnomeButtonLayout } from "./gnomeButtonLayout.ts";

describe("parseGnomeButtonLayout", () => {
  it.each([
    ["'appmenu:close'\n", { left: [], right: ["close"] }],
    ["'close,minimize,maximize:'", { left: ["close", "minimize", "maximize"], right: [] }],
    ["'close:minimize,maximize'", { left: ["close"], right: ["minimize", "maximize"] }],
    ["'appmenu:minimize,maximize,close'", { left: [], right: ["minimize", "maximize", "close"] }],
    // GTK puts a string without a colon on the left.
    ["'close'", { left: ["close"], right: [] }],
    ['"icon:close"', { left: [], right: ["close"] }],
    ["''", { left: [], right: [] }],
    ["':'", { left: [], right: [] }],
    // Unknown tokens, spacing and a second colon.
    [
      "' close , bogus , minimize : spacer,maximize '",
      { left: ["close", "minimize"], right: ["maximize"] },
    ],
    ["'close:close,minimize'", { left: ["close"], right: ["minimize"] }],
    ["'a:b:close'", { left: [], right: [] }],
  ])("reads %j", (output, expected) => {
    expect(parseGnomeButtonLayout(output)).toEqual(expected);
  });

  it.each([
    "",
    "\n",
    "close:minimize",
    "'close:minimize",
    "close:minimize'",
    "'",
    "@s 'close'",
    "No such key",
  ])("cannot read %j", (output) => {
    expect(parseGnomeButtonLayout(output)).toBeNull();
  });
});
