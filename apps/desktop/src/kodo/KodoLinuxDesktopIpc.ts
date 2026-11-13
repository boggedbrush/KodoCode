import { KodoGnomeAccent, KodoWindowButton, KodoWindowChromeState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
import { kodoLinuxDesktopFor } from "./KodoLinuxDesktop.ts";
import * as Channels from "./kodoLinuxDesktopChannels.ts";

/** The Linux desktop part of the bridge: the header bar's buttons, the title bar preference and the accent. */
export const installKodoLinuxDesktopIpc = Effect.fn("desktop.ipc.kodoLinuxDesktop.install")(
  function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    if (environment.platform !== "linux") return;
    const ipc = yield* DesktopIpc.DesktopIpc;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const desktop = kodoLinuxDesktopFor(environment);

    yield* ipc.handleSync(
      DesktopIpc.makeSyncIpcMethod({
        channel: Channels.KODO_GET_WINDOW_CHROME_CHANNEL,
        result: Schema.NullOr(KodoWindowChromeState),
        handler: Effect.fn("desktop.ipc.kodoLinuxDesktop.getWindowChrome")(function* () {
          const window = yield* electronWindow.main;
          return Option.isSome(window) ? desktop.chromeState(window.value) : null;
        }),
      }),
    );
    yield* ipc.handleSync(
      DesktopIpc.makeSyncIpcMethod({
        channel: Channels.KODO_GET_SYSTEM_ACCENT_CHANNEL,
        result: Schema.NullOr(KodoGnomeAccent),
        handler: () => Effect.sync(() => desktop.accentColor()),
      }),
    );
    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: Channels.KODO_WINDOW_ACTION_CHANNEL,
        payload: KodoWindowButton,
        result: Schema.Void,
        handler: Effect.fn("desktop.ipc.kodoLinuxDesktop.runWindowAction")(
          function* (action, event) {
            const window = yield* electronWindow.main;
            if (
              event === undefined ||
              Option.isNone(window) ||
              window.value.webContents.id !== event.sender.id
            ) {
              return;
            }
            desktop.runWindowAction(window.value, action);
          },
        ),
      }),
    );
    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: Channels.KODO_GET_USE_SYSTEM_TITLE_BAR_CHANNEL,
        payload: Schema.Undefined,
        result: Schema.Boolean,
        handler: () => Effect.promise(() => desktop.getUseSystemTitleBar()),
      }),
    );
    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: Channels.KODO_SET_USE_SYSTEM_TITLE_BAR_CHANNEL,
        payload: Schema.Boolean,
        result: Schema.Void,
        handler: (enabled) => Effect.promise(() => desktop.setUseSystemTitleBar(enabled)),
      }),
    );
    yield* Effect.acquireRelease(
      Effect.sync(() => desktop.startAccent()),
      (stop) => Effect.sync(stop),
    );
  },
);
