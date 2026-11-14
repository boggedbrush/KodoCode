// @effect-diagnostics nodeBuiltinImport:off -- Writes the preference file in a throwaway directory.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
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
  it.each([
    ["gone", ["reload", "close"]],
    ["unresponsive", ["wait", "reload", "close"]],
  ] as const)("%s offers %j, and the first answer is never to close", (kind, actions) => {
    const choices = unavailableChoices(kind);
    assert.deepStrictEqual(choices.actions, actions);
    assert.strictEqual(choices.buttons.length, actions.length);
    assert.notStrictEqual(choices.actions[0], "close");
  });
});

interface FakeWindow {
  readonly window: Electron.BrowserWindow;
  readonly sent: Array<[string, unknown]>;
  readonly listeners: Map<string, () => void>;
  readonly contentsListeners: Map<string, () => void>;
  readonly close: ReturnType<typeof vi.fn>;
}

function fakeWindow(options: { readonly visible?: boolean } = {}): FakeWindow {
  const sent: Array<[string, unknown]> = [];
  const listeners = new Map<string, () => void>();
  const contentsListeners = new Map<string, () => void>();
  const close = vi.fn();
  const window = {
    once: vi.fn(),
    on: (event: string, listener: () => void) => listeners.set(event, listener),
    isDestroyed: () => false,
    isVisible: () => options.visible ?? true,
    isMaximized: () => false,
    isFullScreen: () => false,
    close,
    webContents: {
      send: (channel: string, value: unknown) => sent.push([channel, value]),
      on: (event: string, listener: () => void) => contentsListeners.set(event, listener),
      isDestroyed: () => false,
    },
  } as unknown as Electron.BrowserWindow;
  return { window, sent, listeners, contentsListeners, close };
}

interface Setup {
  readonly desktop: KodoLinuxDesktop;
  readonly gsettings: ReturnType<typeof vi.fn>;
  readonly watchPortal: ReturnType<typeof vi.fn>;
  readonly stopPortal: ReturnType<typeof vi.fn>;
  readonly host: KodoWindowHost;
  readonly showMessageBox: ReturnType<typeof vi.fn>;
  readonly reload: ReturnType<typeof vi.fn>;
  /** What the window handed to `host.run`, for a test to run on its own clock. */
  readonly scheduled: Array<Effect.Effect<void>>;
}

function setup(options: {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly stateDir?: string;
  /** What the portal reports as it starts; absent means it lacks the setting. */
  readonly portal?: (handlers: LinuxDesktopSettingsHandlers) => void;
  readonly gsettings?: (schema: string, key: string) => Promise<string | null>;
  /** The portal's `ready`; absent means it has answered already. */
  readonly portalReady?: Promise<unknown>;
  readonly recoveryDialogs?: boolean;
  readonly writePreference?: KodoLinuxDesktopDependencies["writePreference"];
} = {}): Setup {
  const gsettings = vi.fn(options.gsettings ?? (async () => null));
  const stopPortal = vi.fn();
  const watchPortal = vi.fn((handlers: LinuxDesktopSettingsHandlers) => {
    options.portal?.(handlers);
    return { ready: options.portalReady ?? Promise.resolve(), stop: stopPortal };
  });
  const showMessageBox = vi.fn();
  const reload = vi.fn();
  const scheduled: Array<Effect.Effect<void>> = [];
  const dependencies: Partial<KodoLinuxDesktopDependencies> = {
    readGsettings: gsettings,
    watchPortal,
    ...(options.writePreference === undefined ? {} : { writePreference: options.writePreference }),
  };
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
    reload,
    scheduled,
    host: {
      run: (effect) => scheduled.push(effect),
      showMessageBox,
      reload,
      recoveryDialogs: options.recoveryDialogs ?? true,
    },
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

  it.effect("does not wait for a slow portal when gsettings answers", () =>
    Effect.gen(function* () {
      const { desktop } = setup({
        portalReady: new Promise(() => undefined),
        gsettings: async () => "'appmenu:close'\n",
      });
      assert.strictEqual(yield* desktop.prepareFrame(), "kodo");
    }),
  );

  it.effect("keeps the portal's layout when gsettings answers after it", () =>
    Effect.gen(function* () {
      const gsettingsAnswer = yield* Deferred.make<string>();
      const { desktop, host } = setup({
        portal: (handlers) => handlers.onButtonLayout({ left: ["close"], right: [] }),
        gsettings: () => Effect.runPromise(Deferred.await(gsettingsAnswer)),
      });
      const { window } = fakeWindow();
      assert.strictEqual(yield* desktop.prepareFrame(), "kodo");
      desktop.attach(window, "kodo", host);
      yield* Deferred.succeed(gsettingsAnswer, "':minimize,close'");
      yield* Effect.promise(() => Promise.resolve());
      assert.deepStrictEqual(desktop.chromeState(window)?.left, ["close"]);
    }),
  );

  it.effect("lets the portal replace gsettings' layout when it arrives later", () =>
    Effect.gen(function* () {
      let answer: LinuxDesktopSettingsHandlers | undefined;
      const { desktop, host } = setup({
        portalReady: new Promise(() => undefined),
        portal: (handlers) => (answer = handlers),
        gsettings: async () => "':minimize,close'",
      });
      const { window } = fakeWindow();
      assert.strictEqual(yield* desktop.prepareFrame(), "kodo");
      desktop.attach(window, "kodo", host);
      assert.deepStrictEqual(desktop.chromeState(window)?.right, ["minimize", "close"]);
      answer?.onButtonLayout({ left: ["close"], right: [] });
      assert.deepStrictEqual(desktop.chromeState(window)?.left, ["close"]);
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
  /** A dialog the test answers itself, and what it was asked. */
  const dialog = (setupOptions: Parameters<typeof setup>[0] = {}) => {
    const context = setup(setupOptions);
    const shown = Deferred.makeUnsafe<Electron.MessageBoxOptions>();
    let choose: (response: number) => void = () => undefined;
    context.showMessageBox.mockImplementation(
      (_parent: unknown, options: Electron.MessageBoxOptions) => {
        const answer = new Promise((resolve) => (choose = (response) => resolve({ response })));
        options.signal?.addEventListener("abort", () => choose(options.cancelId ?? 0));
        Deferred.doneUnsafe(shown, Effect.succeed(options));
        return answer;
      },
    );
    return { ...context, shown, choose: (response: number) => choose(response) };
  };
  const attached = (setupOptions?: Parameters<typeof setup>[0], windowOptions?: { visible: boolean }) => {
    const context = dialog(setupOptions);
    const fake = fakeWindow(windowOptions);
    context.desktop.attach(fake.window, "kodo", context.host);
    return { ...context, ...fake };
  };

  it.effect("offers reload and close once at a time, and does what was chosen", () =>
    Effect.gen(function* () {
      const { desktop, window, shown, choose, showMessageBox, reload, close } = attached();
      const first = yield* Effect.forkChild(desktop.reportUnavailable(window, "gone"));
      yield* Deferred.await(shown);
      yield* desktop.reportUnavailable(window, "gone");
      assert.strictEqual(showMessageBox.mock.calls.length, 1);
      choose(0);
      yield* Fiber.join(first);
      assert.strictEqual(reload.mock.calls.length, 1);

      const second = yield* Effect.forkChild(desktop.reportUnavailable(window, "gone"));
      yield* Effect.promise(() => Promise.resolve());
      choose(1);
      yield* Fiber.join(second);
      assert.strictEqual(close.mock.calls.length, 1);
    }),
  );

  it.effect.each(["gone", "unresponsive"] as const)(
    "Esc on the %s box never closes the window",
    (kind) =>
      Effect.gen(function* () {
        const { desktop, window, shown, choose, reload, close } = attached();
        const fiber = yield* Effect.forkChild(desktop.reportUnavailable(window, "unresponsive" === kind ? kind : kind));
        const options = yield* Deferred.await(shown);
        const { actions } = unavailableChoices(kind);
        assert.notStrictEqual(actions[options.cancelId ?? -1], "close");
        choose(options.cancelId ?? -1);
        yield* Fiber.join(fiber);
        assert.strictEqual(close.mock.calls.length, 0);
        assert.strictEqual(reload.mock.calls.length, kind === "gone" ? 1 : 0);
      }),
  );

  it.effect("closes the not responding box when the page responds again, and does nothing", () =>
    Effect.gen(function* () {
      const { desktop, window, shown, listeners, reload, close } = attached();
      const fiber = yield* Effect.forkChild(desktop.reportUnavailable(window, "unresponsive"));
      yield* Deferred.await(shown);
      listeners.get("responsive")?.();
      yield* Fiber.join(fiber);
      assert.strictEqual(close.mock.calls.length + reload.mock.calls.length, 0);
    }),
  );

  it.effect("closes a crash box once the page has loaded again, without reloading it", () =>
    Effect.gen(function* () {
      const { desktop, window, shown, contentsListeners, reload } = attached();
      const fiber = yield* Effect.forkChild(desktop.reportUnavailable(window, "gone"));
      yield* Deferred.await(shown);
      contentsListeners.get("did-finish-load")?.();
      yield* Fiber.join(fiber);
      assert.strictEqual(reload.mock.calls.length, 0);
    }),
  );

  it.effect("does not parent the box to a window that is not on screen", () =>
    Effect.gen(function* () {
      const { desktop, window, showMessageBox, choose, shown } = attached(undefined, {
        visible: false,
      });
      const fiber = yield* Effect.forkChild(desktop.reportUnavailable(window, "gone"));
      yield* Deferred.await(shown);
      assert.strictEqual(showMessageBox.mock.calls[0]?.[0], undefined);
      choose(0);
      yield* Fiber.join(fiber);
    }),
  );

  it.effect("says nothing in a development build", () =>
    Effect.gen(function* () {
      const { desktop, window, showMessageBox } = attached({ recoveryDialogs: false });
      yield* desktop.reportUnavailable(window, "gone");
      assert.strictEqual(showMessageBox.mock.calls.length, 0);
    }),
  );

  it.effect("says nothing for a window that has its own frame buttons", () =>
    Effect.gen(function* () {
      const { desktop, host, showMessageBox } = dialog();
      const { window } = fakeWindow();
      desktop.attach(window, "upstream", host);
      yield* desktop.reportUnavailable(window, "gone");
      assert.strictEqual(showMessageBox.mock.calls.length, 0);
    }),
  );
});

describe("a page that loaded without mounting the window buttons", () => {
  const load = (context: ReturnType<typeof attachedPage>, name: "did-start-loading" | "did-finish-load") =>
    context.contentsListeners.get(name)?.();
  const attachedPage = (setupOptions?: Parameters<typeof setup>[0]) => {
    const context = setup(setupOptions);
    const fake = fakeWindow();
    context.desktop.attach(fake.window, "kodo", context.host);
    return { ...context, ...fake };
  };
  const waitedOn = (context: ReturnType<typeof attachedPage>) =>
    Effect.gen(function* () {
      const [expectation] = context.scheduled.splice(-1);
      assert.isDefined(expectation);
      return yield* Effect.forkChild(expectation as Effect.Effect<void>);
    });

  it.effect("gets the recovery box after the wait", () =>
    Effect.gen(function* () {
      const context = attachedPage();
      context.showMessageBox.mockReturnValue(new Promise(() => undefined));
      load(context, "did-start-loading");
      load(context, "did-finish-load");
      yield* waitedOn(context);
      yield* TestClock.adjust(9_999);
      assert.strictEqual(context.showMessageBox.mock.calls.length, 0);
      yield* TestClock.adjust(1);
      assert.strictEqual(context.showMessageBox.mock.calls.length, 1);
    }),
  );

  it.effect.each(["before the page finished loading", "during the wait"] as const)(
    "is left alone when the buttons are reported %s",
    (when) =>
      Effect.gen(function* () {
        const context = attachedPage();
        load(context, "did-start-loading");
        if (when === "before the page finished loading") context.desktop.markChromeReady(context.window);
        load(context, "did-finish-load");
        const fiber = yield* waitedOn(context);
        if (when === "during the wait") context.desktop.markChromeReady(context.window);
        yield* TestClock.adjust(60_000);
        yield* Fiber.join(fiber);
        assert.strictEqual(context.showMessageBox.mock.calls.length, 0);
      }),
  );

  it.effect("is left alone when a newer load has started", () =>
    Effect.gen(function* () {
      const context = attachedPage();
      load(context, "did-start-loading");
      load(context, "did-finish-load");
      const fiber = yield* waitedOn(context);
      load(context, "did-start-loading");
      yield* TestClock.adjust(60_000);
      yield* Fiber.join(fiber);
      assert.strictEqual(context.showMessageBox.mock.calls.length, 0);
    }),
  );

  it.effect("is not asked in a development build", () =>
    Effect.gen(function* () {
      const context = attachedPage({ recoveryDialogs: false });
      load(context, "did-start-loading");
      load(context, "did-finish-load");
      yield* waitedOn(context);
      yield* TestClock.adjust(60_000);
      assert.strictEqual(context.showMessageBox.mock.calls.length, 0);
    }),
  );
});

describe("window state", () => {
  it.effect("follows HTML fullscreen as well as the window's own", () =>
    Effect.gen(function* () {
      const { desktop, host } = setup({ portal: (handlers) => handlers.onButtonLayout(LAYOUT) });
      const { window, contentsListeners, sent } = fakeWindow();
      yield* desktop.prepareFrame();
      desktop.attach(window, "kodo", host);
      contentsListeners.get("enter-html-full-screen")?.();
      assert.strictEqual(desktop.chromeState(window)?.fullscreen, true);
      assert.deepStrictEqual(
        sent.map(([, state]) => (state as { fullscreen: boolean }).fullscreen),
        [true],
      );
      contentsListeners.get("leave-html-full-screen")?.();
      assert.strictEqual(desktop.chromeState(window)?.fullscreen, false);
      assert.strictEqual(sent.length, 2);
    }),
  );
});

describe("start", () => {
  it.effect("does not open the session bus again once it has shut down", () =>
    Effect.gen(function* () {
      const { desktop, watchPortal, stopPortal } = setup({});
      yield* Effect.scoped(desktop.start());
      assert.strictEqual(watchPortal.mock.calls.length, 1);
      assert.strictEqual(stopPortal.mock.calls.length, 1);
      yield* desktop.refresh();
      assert.strictEqual(watchPortal.mock.calls.length, 1);
    }),
  );
});

describe("setUseSystemTitleBar", () => {
  it.effect("keeps the last value when toggles overlap", () =>
    Effect.gen(function* () {
      const firstWriteStarted = yield* Deferred.make<void>();
      const releaseFirstWrite = yield* Deferred.make<void>();
      let saved: boolean | undefined;
      const { desktop } = setup({
        writePreference: async (_directory, _file, enabled) => {
          if (enabled) {
            await Effect.runPromise(
              Deferred.succeed(firstWriteStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releaseFirstWrite)),
              ),
            );
          }
          saved = enabled;
        },
      });
      const first = yield* Effect.forkChild(desktop.setUseSystemTitleBar(true));
      yield* Deferred.await(firstWriteStarted);
      const second = yield* Effect.forkChild(desktop.setUseSystemTitleBar(false));
      yield* Deferred.succeed(releaseFirstWrite, undefined);
      yield* Fiber.joinAll([first, second]);
      assert.strictEqual(saved, false);
    }),
  );

  it.effect("leaves no temporary file behind", () =>
    withTemporaryDirectory((stateDir) =>
      Effect.gen(function* () {
        const { desktop } = setup({ stateDir });
        yield* Effect.all(
          [desktop.setUseSystemTitleBar(true), desktop.setUseSystemTitleBar(false)],
          { concurrency: "unbounded" },
        );
        assert.strictEqual(yield* Effect.promise(() => desktop.getUseSystemTitleBar()), false);
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
