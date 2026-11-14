// @effect-diagnostics nodeBuiltinImport:off -- Writes the preference file in a throwaway directory.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import type * as Electron from "electron";
import { vi } from "vite-plus/test";

import type { GnomeButtonLayout } from "./gnomeButtonLayout.ts";
import {
  KodoLinuxDesktop,
  KodoPreferenceWriteError,
  chooseWindowFrame,
  isGnomeSession,
  unavailableChoices,
  type KodoLinuxDesktopDependencies,
  type KodoWindowFrame,
  type KodoWindowHost,
} from "./KodoLinuxDesktop.ts";
import type { LinuxDesktopSettingsHandlers } from "./LinuxDesktopSettings.ts";

const LAYOUT: GnomeButtonLayout = { left: [], right: ["close"] };
const GNOME = { XDG_CURRENT_DESKTOP: "ubuntu:GNOME" };

describe("isGnomeSession", () => {
  it.each([
    ["GNOME", true],
    ["ubuntu:GNOME", true],
    ["pop:GNOME", true],
    ["GNOME-Classic:GNOME", true],
    ["gnome", true],
    [" ubuntu : GNOME ", true],
    ["Budgie:GNOME", false],
    ["GNOME-Flashback:GNOME", false],
    ["GNOME-Flashback:Unity", false],
    ["Unity:GNOME", false],
    ["KDE", false],
    ["X-Cinnamon", false],
    ["", false],
  ])("%j is %s", (desktop, expected) => {
    assert.strictEqual(isGnomeSession({ XDG_CURRENT_DESKTOP: desktop }), expected);
  });

  it("is false without the variable", () => {
    assert.strictEqual(isGnomeSession({}), false);
  });
});

describe("chooseWindowFrame", () => {
  const choose = (input: Partial<Parameters<typeof chooseWindowFrame>[0]>) =>
    chooseWindowFrame({
      platform: "linux",
      env: GNOME,
      useSystemTitleBar: false,
      layout: LAYOUT,
      ...input,
    });

  it.each<[string, Partial<Parameters<typeof chooseWindowFrame>[0]>, KodoWindowFrame]>([
    ["GNOME by default draws its own buttons", {}, "kodo"],
    ["GNOME with the setting gets the system frame", { useSystemTitleBar: true }, "system"],
    [
      "another desktop by default keeps Chromium's buttons",
      { env: { XDG_CURRENT_DESKTOP: "KDE" } },
      "upstream",
    ],
    ["no desktop by default keeps Chromium's buttons", { env: {} }, "upstream"],
    [
      "another desktop with the setting gets the system frame",
      { env: { XDG_CURRENT_DESKTOP: "KDE" }, useSystemTitleBar: true },
      "system",
    ],
    ["GNOME with an unreadable layout keeps Chromium's buttons", { layout: null }, "upstream"],
    ["macOS is untouched", { platform: "darwin" }, "upstream"],
    [
      "macOS is untouched whatever the setting",
      { platform: "darwin", useSystemTitleBar: true },
      "upstream",
    ],
    ["Windows is untouched", { platform: "win32" }, "upstream"],
  ])("%s", (_name, input, expected) => {
    assert.strictEqual(choose(input), expected);
  });
});

describe("unavailableChoices", () => {
  it("offers waiting only while the page may still answer", () => {
    assert.deepStrictEqual(unavailableChoices("gone").actions, ["reload", "close"]);
    assert.deepStrictEqual(unavailableChoices("unresponsive").actions, ["wait", "reload", "close"]);
  });
});

interface FakeWindow {
  readonly window: Electron.BrowserWindow;
  readonly sent: Array<[string, unknown]>;
  readonly listeners: Map<string, () => void>;
  readonly close: ReturnType<typeof vi.fn>;
  readonly reload: ReturnType<typeof vi.fn>;
}

function fakeWindow(): FakeWindow {
  const sent: Array<[string, unknown]> = [];
  const listeners = new Map<string, () => void>();
  const close = vi.fn();
  const reload = vi.fn();
  const window = {
    once: vi.fn(),
    on: (event: string, listener: () => void) => listeners.set(event, listener),
    isDestroyed: () => false,
    isMaximized: () => false,
    isFullScreen: () => false,
    close,
    webContents: {
      send: (channel: string, value: unknown) => sent.push([channel, value]),
      isDestroyed: () => false,
      reload,
    },
  } as unknown as Electron.BrowserWindow;
  return { window, sent, listeners, close, reload };
}

interface Setup {
  readonly desktop: KodoLinuxDesktop;
  readonly gsettings: ReturnType<typeof vi.fn>;
  readonly watchPortal: ReturnType<typeof vi.fn>;
  readonly stopPortal: ReturnType<typeof vi.fn>;
  readonly host: KodoWindowHost;
  readonly showMessageBox: ReturnType<typeof vi.fn>;
}

function setup(options: {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly stateDir?: string;
  /** What the portal reports as it starts; absent means it lacks the setting. */
  readonly portal?: (handlers: LinuxDesktopSettingsHandlers) => void;
  readonly gsettings?: (schema: string, key: string) => Promise<string | null>;
}): Setup {
  const gsettings = vi.fn(options.gsettings ?? (async () => null));
  const stopPortal = vi.fn();
  const watchPortal = vi.fn((handlers: LinuxDesktopSettingsHandlers) => {
    options.portal?.(handlers);
    return { ready: Promise.resolve(), stop: stopPortal };
  });
  const showMessageBox = vi.fn();
  const dependencies: KodoLinuxDesktopDependencies = { readGsettings: gsettings, watchPortal };
  return {
    desktop: new KodoLinuxDesktop(
      options.platform ?? "linux",
      options.env ?? GNOME,
      options.stateDir ?? "/nonexistent-kodo-state",
      dependencies,
    ),
    gsettings,
    watchPortal,
    stopPortal,
    showMessageBox,
    host: { run: vi.fn(), showMessageBox },
  };
}

const BUTTON_LAYOUT_KEY = "button-layout";
const withTemporaryDirectory = <A, E>(use: (directory: string) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "kodo-state-"))),
    use,
    (directory) => Effect.promise(() => NodeFSP.rm(directory, { recursive: true, force: true })),
  );

describe("prepareFrame", () => {
  it.effect("takes GNOME's layout from the portal without spawning anything", () =>
    Effect.gen(function* () {
      const { desktop, gsettings } = setup({
        portal: (handlers) => handlers.onButtonLayout(LAYOUT),
      });
      assert.strictEqual(yield* desktop.prepareFrame(), "kodo");
      assert.strictEqual(gsettings.mock.calls.length, 0);
    }),
  );

  it.effect("asks gsettings once when the portal lacks the layout", () =>
    Effect.gen(function* () {
      const { desktop, gsettings } = setup({ gsettings: async () => "'appmenu:close'\n" });
      assert.strictEqual(yield* desktop.prepareFrame(), "kodo");
      assert.deepStrictEqual(gsettings.mock.calls, [
        ["org.gnome.desktop.wm.preferences", BUTTON_LAYOUT_KEY],
      ]);
    }),
  );

  it.effect("keeps Chromium's buttons when neither source gives a layout", () =>
    Effect.gen(function* () {
      const { desktop } = setup({ gsettings: async () => "No such schema" });
      assert.strictEqual(yield* desktop.prepareFrame(), "upstream");
    }),
  );

  it.effect("waits for the layout no longer than one gsettings timeout", () =>
    Effect.gen(function* () {
      const { desktop } = setup({ gsettings: () => new Promise(() => undefined) });
      const fiber = yield* Effect.forkChild(desktop.prepareFrame());
      yield* TestClock.adjust(2_000);
      assert.strictEqual(yield* Fiber.join(fiber), "upstream");
    }),
  );

  it.effect("gives the system frame, and reads nothing, when the setting is on", () =>
    withTemporaryDirectory((stateDir) =>
      Effect.gen(function* () {
        const { desktop, gsettings, watchPortal } = setup({ stateDir });
        yield* desktop.setUseSystemTitleBar(true);
        assert.strictEqual(yield* desktop.prepareFrame(), "system");
        assert.strictEqual(gsettings.mock.calls.length, 0);
        assert.strictEqual(watchPortal.mock.calls.length, 0);
      }),
    ),
  );

  it.effect("honours the setting on another desktop and spawns nothing there", () =>
    withTemporaryDirectory((stateDir) =>
      Effect.gen(function* () {
        const kde = setup({ stateDir, env: { XDG_CURRENT_DESKTOP: "KDE" } });
        assert.strictEqual(yield* kde.desktop.prepareFrame(), "upstream");
        yield* kde.desktop.setUseSystemTitleBar(true);
        assert.strictEqual(yield* kde.desktop.prepareFrame(), "system");
        assert.strictEqual(kde.gsettings.mock.calls.length, 0);
        assert.strictEqual(kde.watchPortal.mock.calls.length, 0);
      }),
    ),
  );

  it.effect("leaves macOS and Windows alone", () =>
    Effect.gen(function* () {
      for (const platform of ["darwin", "win32"] as const) {
        const { desktop, gsettings } = setup({ platform });
        assert.strictEqual(yield* desktop.prepareFrame(), "upstream");
        assert.strictEqual(gsettings.mock.calls.length, 0);
      }
    }),
  );
});

describe("refresh", () => {
  const GNOME_LAYOUT = "'appmenu:minimize,close'";

  it.effect("reads gsettings once per interval and never twice at once", () =>
    Effect.gen(function* () {
      let release: (output: string | null) => void = () => undefined;
      const gate = new Promise<string | null>((resolve) => (release = resolve));
      const { desktop, gsettings, host } = setup({ gsettings: () => gate });
      desktop.attach(fakeWindow().window, "kodo", host);

      const fibers = [
        yield* Effect.forkChild(desktop.refresh()),
        yield* Effect.forkChild(desktop.refresh()),
      ];
      release(null);
      yield* Fiber.joinAll(fibers);
      // One refresh read the layout and the accent; the other found it in flight or just done.
      assert.strictEqual(gsettings.mock.calls.length, 2);

      yield* TestClock.adjust(29_999);
      yield* desktop.refresh();
      assert.strictEqual(gsettings.mock.calls.length, 2);
    }),
  );

  it.effect("reads again once the interval has passed", () =>
    Effect.gen(function* () {
      const { desktop, gsettings, host } = setup({});
      desktop.attach(fakeWindow().window, "kodo", host);
      yield* desktop.refresh();
      assert.strictEqual(gsettings.mock.calls.length, 2);
      yield* TestClock.adjust(30_000);
      yield* desktop.refresh();
      assert.strictEqual(gsettings.mock.calls.length, 4);
    }),
  );

  it.effect("asks nothing of gsettings once the portal gave both", () =>
    Effect.gen(function* () {
      const { desktop, gsettings, host } = setup({
        portal: (handlers) => {
          handlers.onButtonLayout(LAYOUT);
          handlers.onAccent("teal");
        },
      });
      desktop.attach(fakeWindow().window, "kodo", host);
      yield* desktop.refresh();
      yield* TestClock.adjust(60_000);
      yield* desktop.refresh();
      assert.strictEqual(gsettings.mock.calls.length, 0);
      assert.strictEqual(desktop.accentColor(), "teal");
    }),
  );

  it.effect("a refresh with nothing to read does not stop a later one", () =>
    Effect.gen(function* () {
      const { desktop, gsettings, host } = setup({
        portal: (handlers) => handlers.onAccent("blue"),
        gsettings: async () => GNOME_LAYOUT,
      });
      // No window draws buttons yet, and the accent came from the portal.
      yield* desktop.refresh();
      assert.strictEqual(gsettings.mock.calls.length, 0);
      desktop.attach(fakeWindow().window, "kodo", host);
      yield* desktop.refresh();
      assert.strictEqual(gsettings.mock.calls.length, 1);
    }),
  );

  it.effect("sends a changed layout to the page and an unchanged one not at all", () =>
    Effect.gen(function* () {
      let output = "'appmenu:close'";
      const { desktop, host } = setup({
        portal: (handlers) => handlers.onAccent("blue"),
        gsettings: async () => output,
      });
      const { window, sent } = fakeWindow();
      desktop.attach(window, "kodo", host);
      yield* desktop.refresh();
      const afterFirst = sent.length;
      yield* TestClock.adjust(30_000);
      yield* desktop.refresh();
      assert.strictEqual(sent.length, afterFirst);

      output = "'close,minimize:'";
      yield* TestClock.adjust(30_000);
      yield* desktop.refresh();
      assert.strictEqual(sent.length, afterFirst + 1);
      assert.deepStrictEqual(desktop.chromeState(window)?.left, ["close", "minimize"]);
    }),
  );

  it.effect("does not read on other desktops", () =>
    Effect.gen(function* () {
      const { desktop, gsettings } = setup({ env: { XDG_CURRENT_DESKTOP: "KDE" } });
      yield* desktop.refresh();
      assert.strictEqual(gsettings.mock.calls.length, 0);
    }),
  );
});

describe("reportUnavailable", () => {
  it("offers reload and close once at a time, and does what was chosen", async () => {
    const { desktop, host, showMessageBox } = setup({});
    const { window, close, reload } = fakeWindow();
    desktop.attach(window, "kodo", host);
    let choose: (response: number) => void = () => undefined;
    showMessageBox.mockImplementation(
      () => new Promise((resolve) => (choose = (response) => resolve({ response }))),
    );

    desktop.reportUnavailable(window, "gone");
    desktop.reportUnavailable(window, "gone");
    assert.strictEqual(showMessageBox.mock.calls.length, 1);
    choose(0);
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(reload.mock.calls.length, 1);

    desktop.reportUnavailable(window, "gone");
    choose(1);
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(close.mock.calls.length, 1);
  });

  it("says nothing for a window that has its own frame buttons", () => {
    const { desktop, host, showMessageBox } = setup({});
    const { window } = fakeWindow();
    desktop.attach(window, "upstream", host);
    desktop.reportUnavailable(window, "gone");
    assert.strictEqual(showMessageBox.mock.calls.length, 0);
  });
});

describe("setUseSystemTitleBar", () => {
  it.effect("keeps the last value of quick toggles and leaves no temporary file", () =>
    withTemporaryDirectory((stateDir) =>
      Effect.gen(function* () {
        const { desktop } = setup({ stateDir });
        yield* Effect.all(
          [desktop.setUseSystemTitleBar(true), desktop.setUseSystemTitleBar(false)],
          { concurrency: "unbounded" },
        );
        yield* desktop.setUseSystemTitleBar(true);
        assert.strictEqual(yield* Effect.promise(() => desktop.getUseSystemTitleBar()), true);
        assert.deepStrictEqual(yield* Effect.promise(() => NodeFSP.readdir(stateDir)), [
          "kodo-window-chrome.json",
        ]);
      }),
    ),
  );

  it.effect("fails with a typed error when the file cannot be written", () =>
    withTemporaryDirectory((directory) =>
      Effect.gen(function* () {
        const blocker = NodePath.join(directory, "file");
        yield* Effect.promise(() => NodeFSP.writeFile(blocker, ""));
        const { desktop } = setup({ stateDir: blocker });
        const exit = yield* Effect.exit(desktop.setUseSystemTitleBar(true));
        assert.isTrue(Exit.isFailure(exit));
        assert.isTrue(
          Exit.isFailure(exit) &&
            JSON.stringify(exit.cause).includes(new KodoPreferenceWriteError({ cause: 0 })._tag),
        );
      }),
    ),
  );
});
