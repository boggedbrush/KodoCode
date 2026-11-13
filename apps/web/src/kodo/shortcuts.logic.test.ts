import {
  compileResolvedKeybindingsConfig,
  DEFAULT_RESOLVED_KEYBINDINGS,
  parseKeybindingShortcut,
} from "@t3tools/shared/keybindings";
import { describe, expect, it } from "@effect/vitest";

import { buildShortcutSections, shortcutKeyCaps, whenCanHold } from "./shortcuts.logic";

const LINUX = { platform: "Linux x86_64", desktop: true } as const;

const entryFor = (sections: ReturnType<typeof buildShortcutSections>, id: string) =>
  sections.flatMap((section) => section.entries).find((entry) => entry.id === id);

describe("buildShortcutSections", () => {
  it("groups the registry like Settings and lists each command once", () => {
    const sections = buildShortcutSections(DEFAULT_RESOLVED_KEYBINDINGS, LINUX);
    const ids = sections.flatMap((section) => section.entries.map((entry) => entry.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(sections.map((section) => section.title)).toEqual(
      expect.arrayContaining(["Navigation", "Threads", "Composer", "Terminal", "Kodo"]),
    );
    expect(
      sections.find((section) => section.id === "composer")?.entries.map((e) => e.id),
    ).toContain("composer.mode");
    expect(sections.findIndex((s) => s.id === "kodo")).toBe(
      sections.findIndex((s) => s.id === "composer") + 1,
    );
  });

  it("lists the Kodo shortcuts: the fixed Shift+Tab, and the commands with no default key", () => {
    const kodo = buildShortcutSections(DEFAULT_RESOLVED_KEYBINDINGS, LINUX).find(
      (section) => section.id === "kodo",
    );
    expect(kodo?.entries.map((entry) => [entry.id, entry.shortcuts.length])).toEqual([
      ["kodo.cycleMode", 1],
      ["composer.subAgents", 0],
      ["orchestrator.open", 0],
    ]);
    expect(kodo?.entries[0]?.shortcuts[0]).toMatchObject({ key: "tab", shiftKey: true });
  });

  it("shows a key someone bound to a Kodo command, once and only under Kodo", () => {
    const bound = compileResolvedKeybindingsConfig([
      { key: "mod+alt+o", command: "orchestrator.open" },
    ]);
    const sections = buildShortcutSections([...DEFAULT_RESOLVED_KEYBINDINGS, ...bound], LINUX);
    expect(entryFor(sections, "orchestrator.open")?.shortcuts).toHaveLength(1);
    expect(
      sections.filter((s) => s.entries.some((e) => e.id === "orchestrator.open")).map((s) => s.id),
    ).toEqual(["kodo"]);
  });

  it("follows a rebound default and merges duplicate keys", () => {
    const rebound = compileResolvedKeybindingsConfig([
      { key: "mod+shift+p", command: "sidebar.toggle" },
      { key: "mod+shift+p", command: "sidebar.toggle" },
    ]);
    const sections = buildShortcutSections([...DEFAULT_RESOLVED_KEYBINDINGS, ...rebound], LINUX);
    const entry = entryFor(sections, "sidebar.toggle");
    expect(entry?.shortcuts.map((shortcut) => shortcutKeyCaps(shortcut, LINUX.platform))).toEqual([
      ["Ctrl", "B"],
      ["Ctrl", "Shift", "P"],
    ]);
  });

  it("lists the shortcuts window's own chord", () => {
    const entry = entryFor(
      buildShortcutSections(DEFAULT_RESOLVED_KEYBINDINGS, LINUX),
      "shortcuts.open",
    );
    expect(entry?.title).toBe("Show keyboard shortcuts");
    expect(entry?.shortcuts.map((s) => shortcutKeyCaps(s, LINUX.platform))).toEqual([
      ["Ctrl", "Shift", "?"],
    ]);
  });

  it("leaves out chords that exist only on the desktop app when the client is the web app", () => {
    expect(
      entryFor(buildShortcutSections(DEFAULT_RESOLVED_KEYBINDINGS, LINUX), "thread.jump.1"),
    ).toBeDefined();
    expect(
      entryFor(
        buildShortcutSections(DEFAULT_RESOLVED_KEYBINDINGS, { ...LINUX, desktop: false }),
        "thread.jump.1",
      ),
    ).toBeUndefined();
  });
});

describe("whenCanHold", () => {
  const when = (expression: string) => {
    const [rule] = compileResolvedKeybindingsConfig([
      { key: "a", command: "sidebar.toggle", when: expression },
    ]);
    return rule?.whenAst;
  };

  it.each([
    ["!terminalFocus", true, true],
    ["composerFocus && draftThreadRoute", false, true],
    ["isDesktop", true, true],
    ["isDesktop", false, false],
    ["!modelPickerOpen && isDesktop", false, false],
    ["isWeb", true, false],
    ["isWeb", false, true],
    ["!isDesktop", true, false],
    ["isDesktop || isWeb", false, true],
    ["isDesktop && isWeb", true, false],
  ])("%s on desktop=%s is %s", (expression, desktop, expected) => {
    expect(whenCanHold(when(expression), desktop)).toBe(expected);
  });

  it("holds without a clause", () => {
    expect(whenCanHold(undefined, false)).toBe(true);
  });
});

describe("shortcutKeyCaps", () => {
  const parse = (value: string) => {
    const shortcut = parseKeybindingShortcut(value);
    if (shortcut === null) throw new Error(`bad shortcut ${value}`);
    return shortcut;
  };

  it("spells modifiers out off macOS and as symbols on it", () => {
    expect(shortcutKeyCaps(parse("mod+alt+shift+a"), "Linux x86_64")).toEqual([
      "Ctrl",
      "Alt",
      "Shift",
      "A",
    ]);
    expect(shortcutKeyCaps(parse("mod+alt+shift+a"), "MacIntel")).toEqual(["⌥", "⇧", "⌘", "A"]);
  });

  it("keeps a plus key and named keys whole", () => {
    expect(shortcutKeyCaps(parse("mod++"), "Linux x86_64")).toEqual(["Ctrl", "+"]);
    expect(shortcutKeyCaps(parse("shift+tab"), "Linux x86_64")).toEqual(["Shift", "Tab"]);
    expect(shortcutKeyCaps(parse("alt+arrowup"), "Linux x86_64")).toEqual(["Alt", "Up"]);
  });
});
