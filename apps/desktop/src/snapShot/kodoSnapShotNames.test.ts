// @effect-diagnostics nodeBuiltinImport:off -- Reads the bundled GNOME extension sources the Shell loads.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { APP_ID } from "@t3tools/shared/appBrand";
import { expect, it } from "vite-plus/test";

import { resolveLinuxDesktopEntryName } from "../app/DesktopEarlyElectronStartup.ts";
import { GNOME_CAPTURE_FILES, GNOME_CAPTURE_UUID } from "./gnomeCaptureBundle.ts";
import {
  GNOME_EXTENSION_BUS_NAME,
  GNOME_EXTENSION_OBJECT_PATH,
  KDE_CAPTURE_DESKTOP_FILE,
  snapShotClientName,
} from "./kodoSnapShotNames.ts";

const extensionDirectory = NodePath.resolve(import.meta.dirname, "../../gnome-extension");
const read = (name: string) => NodeFS.readFileSync(NodePath.join(extensionDirectory, name), "utf8");
const constant = (source: string, name: string) =>
  new RegExp(`^const ${name} = "([^"]+)";$`, "m").exec(source)?.[1];

it("keeps the Shell extension and the app agreeing on D-Bus names", () => {
  const extension = read("extension.js");
  expect(constant(extension, "NAME")).toBe(GNOME_EXTENSION_BUS_NAME);
  expect(constant(extension, "PATH")).toBe(GNOME_EXTENSION_OBJECT_PATH);

  const clientList = /CLIENT_NAMES = \[([^\]]*)\]/.exec(read("captureService.js"))?.[1] ?? "";
  const clientNames = [...clientList.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  expect(clientNames).not.toHaveLength(0);
  for (const isDevelopment of [false, true]) {
    const linuxAppId = resolveLinuxDesktopEntryName(isDevelopment).replace(/\.desktop$/, "");
    expect(clientNames).toContain(snapShotClientName(linuxAppId));
  }
});

it("gives the extension, the bundle and the installer one UUID that upstream does not use", () => {
  const metadata: { uuid: string } = JSON.parse(read("metadata.json"));
  expect(metadata.uuid).toBe(GNOME_CAPTURE_UUID);
  expect(GNOME_CAPTURE_UUID).not.toBe("snap-shot@t3.codes");
  for (const file of GNOME_CAPTURE_FILES) {
    expect(NodeFS.existsSync(NodePath.join(extensionDirectory, file))).toBe(true);
  }
});

it("names no bus name, extension or helper that upstream's app also owns", () => {
  const upstream = [
    "com.t3tools.T3Code",
    "org.gnome.Shell.Extensions.T3SnapShot",
    "snap-shot@t3.codes",
  ];
  for (const name of [
    GNOME_EXTENSION_BUS_NAME,
    GNOME_EXTENSION_OBJECT_PATH,
    GNOME_CAPTURE_UUID,
    KDE_CAPTURE_DESKTOP_FILE,
    snapShotClientName(APP_ID),
  ]) {
    expect(upstream.some((value) => name.includes(value) || name.includes("T3SnapShot"))).toBe(
      false,
    );
  }
});
