import type { DesktopBridge, DesktopCapabilities, DesktopRuntime } from "@t3tools/contracts";

export function readDesktopBridge(): DesktopBridge | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.desktopBridge;
}

export function readDesktopRuntime(): DesktopRuntime | null {
  return readDesktopBridge()?.bootstrap.runtime ?? null;
}

export function readDesktopConnectionWsUrl(): string | null {
  return readDesktopBridge()?.bootstrap.connection.wsUrl ?? null;
}

export function supportsDesktopCapability(capability: keyof DesktopCapabilities): boolean {
  const bridge = readDesktopBridge();
  if (!bridge) {
    return false;
  }

  return bridge.bootstrap.capabilities[capability] === true;
}

export const isDesktopApp = typeof window !== "undefined" && window.desktopBridge !== undefined;

export const isElectronDesktop = readDesktopRuntime() === "electron";
