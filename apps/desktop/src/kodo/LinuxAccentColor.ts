import type { KodoGnomeAccent } from "@t3tools/contracts";
import { Message, MessageType, Variant, sessionBus, type MessageBus } from "dbus-next";

import { gnomeAccentFromPortalColor } from "./gnomeAccent.ts";

const PORTAL = "org.freedesktop.portal.Desktop";
const PATH = "/org/freedesktop/portal/desktop";
const SETTINGS = "org.freedesktop.portal.Settings";
const DBUS = "org.freedesktop.DBus";
const NAMESPACE = "org.freedesktop.appearance";
const KEY = "accent-color";

function decode(value: unknown): KodoGnomeAccent | null {
  let color = value;
  // The deprecated Read method nests the value in a second variant.
  while (color instanceof Variant) color = color.value;
  return gnomeAccentFromPortalColor(color);
}

const settingsCall = (member: "ReadOne" | "Read") =>
  new Message({
    destination: PORTAL,
    path: PATH,
    interface: SETTINGS,
    member,
    signature: "ss",
    body: [NAMESPACE, KEY],
  });

/**
 * Follows the desktop accent colour through the XDG settings portal, like the colour scheme in
 * ElectronTheme. `ready` resolves to whether the portal answered a read; false sends the caller to
 * gsettings, and a later portal change still reports.
 */
export function watchLinuxAccentColor(
  onChange: (accent: KodoGnomeAccent | null) => void,
  bus: MessageBus = sessionBus(),
) {
  let closed = false;
  let changed = false;
  const report = (value: unknown) => {
    if (!closed) onChange(decode(value));
  };
  const onMessage = (message: Message) => {
    if (
      message.type !== MessageType.SIGNAL ||
      message.path !== PATH ||
      message.interface !== SETTINGS ||
      message.member !== "SettingChanged"
    )
      return;
    const [namespace, key, value] = message.body;
    if (namespace !== NAMESPACE || key !== KEY) return;
    changed = true;
    report(value);
  };
  const ignore = () => undefined;

  bus.on("error", ignore);
  bus.on("message", onMessage);
  const ready = (async () => {
    await bus.call(
      new Message({
        destination: DBUS,
        path: "/org/freedesktop/DBus",
        interface: DBUS,
        member: "AddMatch",
        signature: "s",
        body: [
          `type='signal',interface='${SETTINGS}',member='SettingChanged',path='${PATH}',arg0='${NAMESPACE}',arg1='${KEY}'`,
        ],
      }),
    );
    // ReadOne needs Settings portal version 2; older portals only offer Read.
    const reply = await bus
      .call(settingsCall("ReadOne"))
      .catch(() => bus.call(settingsCall("Read")));
    // A change signal can overtake this reply, which then carries the older value.
    if (reply && !changed) report(reply.body[0]);
    return reply !== undefined;
  })().catch(() => false);

  return {
    ready,
    stop: () => {
      closed = true;
      bus.removeListener("message", onMessage);
      bus.disconnect();
    },
  };
}
