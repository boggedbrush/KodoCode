import type {
  KeybindingCommand,
  KeybindingShortcut,
  KeybindingWhenNode,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";

import { formatShortcutKeyLabel, shortcutConflictKey } from "../keybindings";
import { isMacPlatform } from "../lib/utils";
import {
  buildKeybindingRows,
  commandLabel,
  groupKeybindingRows,
} from "../components/settings/KeybindingsSettings.logic";

export interface ShortcutEntry {
  readonly id: string;
  readonly title: string;
  /** Empty for a command nobody has bound a key to. */
  readonly shortcuts: ReadonlyArray<KeybindingShortcut>;
}

export interface ShortcutSection {
  readonly id: string;
  readonly title: string;
  readonly entries: ReadonlyArray<ShortcutEntry>;
}

const NO_MODIFIERS = { metaKey: false, ctrlKey: false, altKey: false, modKey: false } as const;

// The Kodo commands that ship without a default key. They are listed even unbound, under Kodo,
// so the overview says they exist.
const KODO_COMMANDS: ReadonlyArray<KeybindingCommand> = ["composer.subAgents", "orchestrator.open"];

// Shift+Tab is handled by the composer itself (components/chat/composerCommandKey.ts), not by a
// keybinding command, so the registry cannot list it.
const KODO_FIXED_ENTRIES: ReadonlyArray<ShortcutEntry> = [
  {
    id: "kodo.cycleMode",
    title: "Cycle interaction mode (Ask, Plan, Code, Review)",
    shortcuts: [{ key: "tab", shiftKey: true, ...NO_MODIFIERS }],
  },
];

const KODO_TITLES: Partial<Record<KeybindingCommand, string>> = {
  "composer.subAgents": "Toggle sub-agents for this thread",
  "orchestrator.open": "Open the Orchestrator",
  "shortcuts.open": "Show keyboard shortcuts",
};

/**
 * Whether a binding's `when` clause can hold in this client. Focus and panel state come and go, so
 * those never rule a binding out; only where the app runs does: `isDesktop` and `isWeb`.
 */
export function whenCanHold(node: KeybindingWhenNode | undefined, desktop: boolean): boolean {
  if (node === undefined) return true;
  switch (node.type) {
    case "identifier":
      return node.name === "isDesktop" ? desktop : node.name === "isWeb" ? !desktop : true;
    case "not":
      return node.node.type === "identifier" &&
        (node.node.name === "isDesktop" || node.node.name === "isWeb")
        ? !whenCanHold(node.node, desktop)
        : true;
    case "and":
      return whenCanHold(node.left, desktop) && whenCanHold(node.right, desktop);
    case "or":
      return whenCanHold(node.left, desktop) || whenCanHold(node.right, desktop);
  }
}

/** The key caps of a shortcut, one string per cap: `["Ctrl", "Shift", "K"]`, or `["⇧", "⌘", "K"]` on macOS. */
export function shortcutKeyCaps(shortcut: KeybindingShortcut, platform: string): string[] {
  const mac = isMacPlatform(platform);
  const meta = shortcut.metaKey || (shortcut.modKey && mac);
  const ctrl = shortcut.ctrlKey || (shortcut.modKey && !mac);
  const caps = mac
    ? [ctrl && "⌃", shortcut.altKey && "⌥", shortcut.shiftKey && "⇧", meta && "⌘"]
    : [ctrl && "Ctrl", shortcut.altKey && "Alt", shortcut.shiftKey && "Shift", meta && "Meta"];
  return [
    ...caps.filter((cap): cap is string => cap !== false),
    formatShortcutKeyLabel(shortcut.key),
  ];
}

function mergeShortcuts(
  shortcuts: ReadonlyArray<KeybindingShortcut>,
  platform: string,
): KeybindingShortcut[] {
  const seen = new Set<string>();
  return shortcuts.filter((shortcut) => {
    const key = shortcutConflictKey(shortcut, platform);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The shortcuts overview, from the live keybinding registry: the same effective bindings and the
 * same groups as Settings -> Keybindings, so a rebound key shows here. Kodo's own shortcuts are
 * gathered under one section.
 */
export function buildShortcutSections(
  keybindings: ResolvedKeybindingsConfig,
  options: { readonly platform: string; readonly desktop: boolean },
): ShortcutSection[] {
  const rows = buildKeybindingRows(keybindings, options.platform).filter((row) =>
    whenCanHold(row.binding.whenAst, options.desktop),
  );
  const kodoRows = rows.filter((row) => KODO_COMMANDS.includes(row.command));

  const sections: ShortcutSection[] = groupKeybindingRows(
    rows.filter((row) => !KODO_COMMANDS.includes(row.command)),
  ).map((group) => {
    const byCommand = new Map<KeybindingCommand, KeybindingShortcut[]>();
    for (const row of group.rows) {
      byCommand.set(row.command, [...(byCommand.get(row.command) ?? []), row.binding.shortcut]);
    }
    return {
      id: group.id,
      title: group.title,
      entries: [...byCommand].map(([command, shortcuts]) => ({
        id: command,
        title: KODO_TITLES[command] ?? commandLabel(command),
        shortcuts: mergeShortcuts(shortcuts, options.platform),
      })),
    };
  });

  const kodo: ShortcutSection = {
    id: "kodo",
    title: "Kodo",
    entries: [
      ...KODO_FIXED_ENTRIES,
      ...KODO_COMMANDS.map((command) => ({
        id: command,
        title: KODO_TITLES[command] ?? commandLabel(command),
        shortcuts: mergeShortcuts(
          kodoRows.filter((row) => row.command === command).map((row) => row.binding.shortcut),
          options.platform,
        ),
      })),
    ],
  };
  const afterComposer = sections.findIndex((section) => section.id === "composer") + 1;
  sections.splice(afterComposer === 0 ? sections.length : afterComposer, 0, kodo);
  return sections;
}
