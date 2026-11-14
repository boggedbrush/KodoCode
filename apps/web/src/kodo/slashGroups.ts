// The slash menu's headings: Kodo's commands, the loop's, T3's own, the provider's, then skills. The
// menu is one list the arrow keys walk, so the items are put in group order here and the menu only
// draws a heading where the group changes.
export type KodoSlashGroup = "Kodo" | "Loop" | "Built in" | "Provider commands" | "Skills";

const ORDER: ReadonlyArray<KodoSlashGroup> = [
  "Kodo",
  "Loop",
  "Built in",
  "Provider commands",
  "Skills",
];

const MODE_COMMANDS = new Set(["ask", "plan", "code", "review", "usage"]);

interface SlashGroupItem {
  readonly type: string;
  readonly command?: unknown;
}

/** Which heading an item sits under; null for an item that is not a slash command or skill. */
export function kodoSlashGroup(item: SlashGroupItem): KodoSlashGroup | null {
  if (item.type === "provider-slash-command") return "Provider commands";
  if (item.type === "skill") return "Skills";
  if (item.type !== "slash-command") return null;
  if (item.command === "loop") return "Loop";
  return typeof item.command === "string" && MODE_COMMANDS.has(item.command) ? "Kodo" : "Built in";
}

/** The items in group order, each group keeping the order the search gave it. */
export function groupKodoSlashItems<Item extends SlashGroupItem>(
  items: ReadonlyArray<Item>,
): Item[] {
  const rank = (item: Item) => {
    const group = kodoSlashGroup(item);
    return group === null ? ORDER.length : ORDER.indexOf(group);
  };
  return items
    .map((item, index) => ({ item, index, rank: rank(item) }))
    .toSorted((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item);
}

/** Consecutive items under one heading, for the menu to draw. */
export function kodoSlashRuns<Item extends SlashGroupItem>(
  items: ReadonlyArray<Item>,
): Array<{ readonly heading: KodoSlashGroup | null; readonly items: Item[] }> {
  const runs: Array<{ heading: KodoSlashGroup | null; items: Item[] }> = [];
  for (const item of items) {
    const heading = kodoSlashGroup(item);
    const last = runs.at(-1);
    if (last !== undefined && last.heading === heading) last.items.push(item);
    else runs.push({ heading, items: [item] });
  }
  return runs;
}
