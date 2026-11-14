import { describe, expect, it } from "@effect/vitest";

import { groupKodoSlashItems, kodoSlashGroup, kodoSlashRuns } from "./slashGroups";

const slash = (command: string) => ({ type: "slash-command", command });

describe("the slash menu's groups", () => {
  it.each([
    [slash("code"), "Kodo"],
    [slash("usage"), "Kodo"],
    [slash("loop"), "Loop"],
    [slash("model"), "Built in"],
    [slash("clear"), "Built in"],
    [{ type: "provider-slash-command" }, "Provider commands"],
    [{ type: "skill" }, "Skills"],
    [{ type: "path" }, null],
  ])("%j sits under %s", (item, group) => {
    expect(kodoSlashGroup(item)).toBe(group);
  });

  it("puts the items in group order and keeps the search's order inside each group", () => {
    const items = [
      { id: "s1", type: "skill" },
      { id: "p1", type: "provider-slash-command" },
      { id: "m1", ...slash("model") },
      { id: "l1", ...slash("loop") },
      { id: "l2", ...slash("loop") },
      { id: "c1", ...slash("review") },
      { id: "c2", ...slash("ask") },
    ];
    expect(groupKodoSlashItems(items).map((item) => item.id)).toEqual([
      "c1",
      "c2",
      "l1",
      "l2",
      "m1",
      "p1",
      "s1",
    ]);
  });

  it("puts the group of a name match first, so Enter picks what was typed", () => {
    // `/new` is the provider's own command; `/side` only matches it through its description.
    const items = [
      { id: "provider-new", type: "provider-slash-command", command: { name: "new" } },
      { id: "side", ...slash("side") },
      { id: "skill", type: "skill", skill: { name: "new-feature" } },
    ];
    expect(groupKodoSlashItems(items, "/new").map((item) => item.id)).toEqual([
      "provider-new",
      "side",
      "skill",
    ]);
    // A description-only match, or no query, keeps the usual order.
    expect(groupKodoSlashItems(items, "chat").map((item) => item.id)).toEqual([
      "side",
      "provider-new",
      "skill",
    ]);
    expect(groupKodoSlashItems(items).map((item) => item.id)).toEqual([
      "side",
      "provider-new",
      "skill",
    ]);
    // The menu still draws each heading once, in the order the keys walk.
    expect(kodoSlashRuns(groupKodoSlashItems(items, "/new")).map((run) => run.heading)).toEqual([
      "Provider commands",
      "Built in",
      "Skills",
    ]);
  });

  it("draws one heading per run, and none for items that belong to no group", () => {
    const runs = kodoSlashRuns([
      slash("code"),
      slash("ask"),
      slash("model"),
      { type: "path" },
      { type: "path" },
    ]);
    expect(runs.map((run) => [run.heading, run.items.length])).toEqual([
      ["Kodo", 2],
      ["Built in", 1],
      [null, 2],
    ]);
  });
});
