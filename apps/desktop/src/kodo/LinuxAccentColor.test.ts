// @effect-diagnostics nodeBuiltinImport:off -- Event-driven fake of the portal transport.
import * as NodeEvents from "node:events";
import { DBusError, Message, MessageType, Variant, type MessageBus } from "dbus-next";
import { expect, it, vi } from "vite-plus/test";

import type { KodoGnomeAccent } from "@t3tools/contracts";

import { watchLinuxAccentColor } from "./LinuxAccentColor.ts";

const PATH = "/org/freedesktop/portal/desktop";
const SETTINGS = "org.freedesktop.portal.Settings";
const BLUE: [number, number, number] = [0x35 / 255, 0x84 / 255, 0xe4 / 255];
const PURPLE: [number, number, number] = [0x91 / 255, 0x41 / 255, 0xac / 255];

class FakeBus extends NodeEvents.EventEmitter {
  disconnect = vi.fn();
  readonly settings: { readOne?: unknown; read?: unknown };
  constructor(settings: { readOne?: unknown; read?: unknown }) {
    super();
    this.settings = settings;
  }

  async call(message: Message) {
    if (message.member === "AddMatch")
      return new Message({ type: MessageType.METHOD_RETURN, replySerial: "1" });
    const value = message.member === "ReadOne" ? this.settings.readOne : this.settings.read;
    if (value === undefined) throw new DBusError("org.freedesktop.DBus.Error.UnknownMethod", "");
    return new Message({
      type: MessageType.METHOD_RETURN,
      replySerial: "1",
      signature: "v",
      body: [value],
    });
  }

  changed(namespace: string, key: string, value: unknown) {
    this.emit(
      "message",
      new Message({
        type: MessageType.SIGNAL,
        path: PATH,
        interface: SETTINGS,
        member: "SettingChanged",
        body: [namespace, key, new Variant("(ddd)", value)],
      }),
    );
  }
}

function watch(bus: FakeBus) {
  const accents: Array<KodoGnomeAccent | null> = [];
  const { ready, stop } = watchLinuxAccentColor(
    (accent) => accents.push(accent),
    bus as unknown as MessageBus,
  );
  return { accents, ready, stop };
}

it("reads the accent and follows portal changes", async () => {
  const bus = new FakeBus({ readOne: new Variant("(ddd)", BLUE) });
  const { accents, ready, stop } = watch(bus);
  expect(await ready).toBe(true);

  bus.changed("org.freedesktop.appearance", "accent-color", PURPLE);
  bus.changed("org.freedesktop.appearance", "color-scheme", PURPLE);
  bus.changed("org.gnome.desktop.interface", "accent-color", BLUE);
  // A desktop without an accent sends values outside 0..1.
  bus.changed("org.freedesktop.appearance", "accent-color", [-1, -1, -1]);
  expect(accents).toEqual(["blue", "purple", null]);

  stop();
  bus.changed("org.freedesktop.appearance", "accent-color", BLUE);
  expect(accents).toEqual(["blue", "purple", null]);
  expect(bus.disconnect).toHaveBeenCalledOnce();
});

it("falls back to the nested Read reply on portals without ReadOne", async () => {
  const bus = new FakeBus({ read: new Variant("v", new Variant("(ddd)", PURPLE)) });
  const { accents, ready } = watch(bus);
  expect(await ready).toBe(true);
  expect(accents).toEqual(["purple"]);
});

it("reports a portal that cannot be read so the caller can ask gsettings", async () => {
  const bus = new FakeBus({});
  const { accents, ready } = watch(bus);
  expect(await ready).toBe(false);
  expect(accents).toEqual([]);
});
