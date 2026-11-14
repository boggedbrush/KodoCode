// @effect-diagnostics nodeBuiltinImport:off -- Event-driven fake of the portal transport.
import * as NodeEvents from "node:events";
import { DBusError, Message, MessageType, Variant, type MessageBus } from "dbus-next";
import { expect, it, vi } from "vite-plus/test";

import type { KodoGnomeAccent } from "@t3tools/contracts";

import type { GnomeButtonLayout } from "./gnomeButtonLayout.ts";
import { watchLinuxDesktopSettings } from "./LinuxDesktopSettings.ts";

const PATH = "/org/freedesktop/portal/desktop";
const SETTINGS = "org.freedesktop.portal.Settings";
const BLUE: [number, number, number] = [0x35 / 255, 0x84 / 255, 0xe4 / 255];
const APPEARANCE = "org.freedesktop.appearance";
const WM = "org.gnome.desktop.wm.preferences";
const PURPLE: [number, number, number] = [0x91 / 255, 0x41 / 255, 0xac / 255];

class FakeBus extends NodeEvents.EventEmitter {
  disconnect = vi.fn();
  readonly settings: Record<string, { readOne?: unknown; read?: unknown }>;
  readonly matches: string[] = [];
  constructor(settings: Record<string, { readOne?: unknown; read?: unknown }>) {
    super();
    this.settings = settings;
  }

  async call(message: Message) {
    if (message.member === "AddMatch") {
      this.matches.push(String(message.body[0]));
      return new Message({ type: MessageType.METHOD_RETURN, replySerial: "1" });
    }
    const [namespace, key] = message.body as [string, string];
    const entry = this.settings[`${namespace} ${key}`] ?? {};
    const value = message.member === "ReadOne" ? entry.readOne : entry.read;
    if (value === undefined) throw new DBusError("org.freedesktop.DBus.Error.UnknownMethod", "");
    return new Message({
      type: MessageType.METHOD_RETURN,
      replySerial: "1",
      signature: "v",
      body: [value],
    });
  }

  changed(namespace: string, key: string, signature: string, value: unknown) {
    this.emit(
      "message",
      new Message({
        type: MessageType.SIGNAL,
        path: PATH,
        interface: SETTINGS,
        member: "SettingChanged",
        body: [namespace, key, new Variant(signature, value)],
      }),
    );
  }
}

const ACCENT = `${APPEARANCE} accent-color`;
const LAYOUT = `${WM} button-layout`;

function watch(bus: FakeBus) {
  const accents: Array<KodoGnomeAccent | null> = [];
  const layouts: GnomeButtonLayout[] = [];
  const { ready, stop } = watchLinuxDesktopSettings(
    {
      onAccent: (accent) => accents.push(accent),
      onButtonLayout: (layout) => layouts.push(layout),
    },
    bus as unknown as MessageBus,
  );
  return { accents, layouts, ready, stop };
}

it("reads the accent and the layout on one bus and follows portal changes", async () => {
  const bus = new FakeBus({
    [ACCENT]: { readOne: new Variant("(ddd)", BLUE) },
    [LAYOUT]: { readOne: new Variant("s", "appmenu:close") },
  });
  const { accents, layouts, ready, stop } = watch(bus);
  expect(await ready).toEqual({ accent: true, buttonLayout: true });
  expect(bus.matches).toHaveLength(2);

  bus.changed(APPEARANCE, "accent-color", "(ddd)", PURPLE);
  bus.changed(APPEARANCE, "color-scheme", "(ddd)", PURPLE);
  bus.changed("org.gnome.desktop.interface", "accent-color", "(ddd)", BLUE);
  // A desktop without an accent sends values outside 0..1.
  bus.changed(APPEARANCE, "accent-color", "(ddd)", [-1, -1, -1]);
  expect(accents).toEqual(["blue", "purple", null]);

  bus.changed(WM, "button-layout", "s", "close,minimize,maximize:");
  bus.changed(WM, "theme", "s", "close:");
  // Anything but a string is not a layout.
  bus.changed(WM, "button-layout", "i", 3);
  expect(layouts).toEqual([
    { left: [], right: ["close"] },
    { left: ["close", "minimize", "maximize"], right: [] },
  ]);

  stop();
  bus.changed(APPEARANCE, "accent-color", "(ddd)", BLUE);
  bus.changed(WM, "button-layout", "s", ":close");
  expect(accents).toHaveLength(3);
  expect(layouts).toHaveLength(2);
  expect(bus.disconnect).toHaveBeenCalledOnce();
});

it("falls back to the nested Read reply on portals without ReadOne", async () => {
  const bus = new FakeBus({
    [ACCENT]: { read: new Variant("v", new Variant("(ddd)", PURPLE)) },
    [LAYOUT]: { read: new Variant("v", new Variant("s", ":minimize,close")) },
  });
  const { accents, layouts, ready } = watch(bus);
  expect(await ready).toEqual({ accent: true, buttonLayout: true });
  expect(accents).toEqual(["purple"]);
  expect(layouts).toEqual([{ left: [], right: ["minimize", "close"] }]);
});

it("reports the setting a portal lacks, so the caller can ask gsettings for it", async () => {
  const bus = new FakeBus({ [ACCENT]: { readOne: new Variant("(ddd)", BLUE) } });
  const { accents, layouts, ready } = watch(bus);
  expect(await ready).toEqual({ accent: true, buttonLayout: false });
  expect(accents).toEqual(["blue"]);
  expect(layouts).toEqual([]);
});

it("reports a portal that cannot be read at all", async () => {
  const { accents, layouts, ready } = watch(new FakeBus({}));
  expect(await ready).toEqual({ accent: false, buttonLayout: false });
  expect(accents).toEqual([]);
  expect(layouts).toEqual([]);
});
