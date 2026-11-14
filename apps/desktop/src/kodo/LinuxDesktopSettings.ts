import type { KodoGnomeAccent } from "@t3tools/contracts";
import { Message, MessageType, Variant, sessionBus, type MessageBus } from "dbus-next";

import { gnomeAccentFromPortalColor } from "./gnomeAccent.ts";
import { parseGnomeButtonLayoutValue, type GnomeButtonLayout } from "./gnomeButtonLayout.ts";

const PORTAL = "org.freedesktop.portal.Desktop";
const PATH = "/org/freedesktop/portal/desktop";
const SETTINGS = "org.freedesktop.portal.Settings";
const DBUS = "org.freedesktop.DBus";

export interface LinuxDesktopSettingsHandlers {
  readonly onAccent: (accent: KodoGnomeAccent | null) => void;
  readonly onButtonLayout: (layout: GnomeButtonLayout) => void;
}

/** Which settings the portal could be read for; a false one is the caller's to read some other way. */
export interface LinuxDesktopSettingsAnswers {
  readonly accent: boolean;
  readonly buttonLayout: boolean;
}

interface WatchedSetting {
  readonly name: keyof LinuxDesktopSettingsAnswers;
  readonly namespace: string;
  readonly key: string;
  /** False for a value that is not what the setting holds, which counts as not answered. */
  readonly apply: (value: unknown, handlers: LinuxDesktopSettingsHandlers) => boolean;
}

const WATCHED: ReadonlyArray<WatchedSetting> = [
  {
    name: "accent",
    namespace: "org.freedesktop.appearance",
    key: "accent-color",
    apply: (value, handlers) => {
      handlers.onAccent(gnomeAccentFromPortalColor(value));
      return true;
    },
  },
  {
    // xdg-desktop-portal-gnome passes GNOME's window manager preferences through as a string.
    name: "buttonLayout",
    namespace: "org.gnome.desktop.wm.preferences",
    key: "button-layout",
    apply: (value, handlers) => {
      if (typeof value !== "string") return false;
      handlers.onButtonLayout(parseGnomeButtonLayoutValue(value));
      return true;
    },
  },
];

function unwrap(value: unknown): unknown {
  let inner = value;
  // The deprecated Read method nests the value in a second variant.
  while (inner instanceof Variant) inner = inner.value;
  return inner;
}

const settingsCall = (member: "ReadOne" | "Read", setting: WatchedSetting) =>
  new Message({
    destination: PORTAL,
    path: PATH,
    interface: SETTINGS,
    member,
    signature: "ss",
    body: [setting.namespace, setting.key],
  });

/**
 * Follows the desktop accent colour and GNOME's window button layout through the XDG settings
 * portal, like the colour scheme in ElectronTheme, on one bus. `ready` says which settings the
 * portal answered; the others go to gsettings, and a later portal change still reports.
 */
export function watchLinuxDesktopSettings(
  handlers: LinuxDesktopSettingsHandlers,
  bus: MessageBus = sessionBus(),
) {
  let closed = false;
  const changed = new Set<string>();
  const onMessage = (message: Message) => {
    if (
      message.type !== MessageType.SIGNAL ||
      message.path !== PATH ||
      message.interface !== SETTINGS ||
      message.member !== "SettingChanged"
    )
      return;
    const [namespace, key, value] = message.body;
    const setting = WATCHED.find((entry) => entry.namespace === namespace && entry.key === key);
    if (setting === undefined) return;
    changed.add(setting.name);
    if (!closed) setting.apply(unwrap(value), handlers);
  };
  const ignore = () => undefined;

  const read = async (setting: WatchedSetting): Promise<boolean> => {
    try {
      // ReadOne needs Settings portal version 2; older portals only offer Read.
      const reply = await bus
        .call(settingsCall("ReadOne", setting))
        .catch(() => bus.call(settingsCall("Read", setting)));
      // A change signal can overtake this reply, which then carries the older value.
      const value = unwrap(reply?.body[0]);
      if (changed.has(setting.name)) return true;
      return closed ? true : setting.apply(value, handlers);
    } catch {
      // A portal without the key answers with an error.
      return false;
    }
  };

  bus.on("error", ignore);
  bus.on("message", onMessage);
  const ready = (async (): Promise<LinuxDesktopSettingsAnswers> => {
    try {
      await Promise.all(
        WATCHED.map((setting) =>
          bus.call(
            new Message({
              destination: DBUS,
              path: "/org/freedesktop/DBus",
              interface: DBUS,
              member: "AddMatch",
              signature: "s",
              body: [
                `type='signal',interface='${SETTINGS}',member='SettingChanged',path='${PATH}',arg0='${setting.namespace}',arg1='${setting.key}'`,
              ],
            }),
          ),
        ),
      );
    } catch {
      return { accent: false, buttonLayout: false };
    }
    const [accent, buttonLayout] = await Promise.all(WATCHED.map(read));
    return { accent: accent === true, buttonLayout: buttonLayout === true };
  })();

  return {
    ready,
    stop: () => {
      closed = true;
      bus.removeListener("message", onMessage);
      bus.disconnect();
    },
  };
}
