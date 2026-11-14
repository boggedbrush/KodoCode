import { useEffect, useState } from "react";

import { isElectron } from "../../env";
import {
  setFollowSystemAccent,
  useFollowSystemAccent,
  useSystemAccent,
} from "../../kodo/systemAccent";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { searchableSetting } from "./settingsSearch";
import { SettingsRow } from "./settingsLayout";

/**
 * The Linux desktop app's window frame and accent settings: whether the window uses the system's own
 * frame, and whether the Kodo theme follows the desktop's accent colour. Nothing renders elsewhere,
 * where the bridge has no Linux part.
 */
export function KodoLinuxDesktopSettings() {
  const bridge = isElectron ? window.desktopBridge?.kodoLinuxDesktop : undefined;
  const [useSystemTitleBar, setUseSystemTitleBar] = useState<boolean | null>(null);
  const followAccent = useFollowSystemAccent();
  const systemAccent = useSystemAccent();

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the saved preference from the Electron main process
  useEffect(() => {
    let current = true;
    void bridge?.getUseSystemTitleBar().then((saved) => {
      if (current) setUseSystemTitleBar(saved);
    });
    return () => {
      current = false;
    };
  }, [bridge]);

  if (bridge === undefined) return null;

  return (
    <>
      <SettingsRow
        {...searchableSetting("system-title-bar")}
        description="Use your desktop's own window frame and title bar. Off, Kodo Code draws the window buttons in its header bar on GNOME, and Chromium draws them elsewhere. Applies at next start."
        control={
          <Switch
            checked={useSystemTitleBar === true}
            disabled={useSystemTitleBar === null}
            onCheckedChange={(checked) => {
              const next = Boolean(checked);
              setUseSystemTitleBar(next);
              bridge.setUseSystemTitleBar(next).catch(() => {
                // Writes land in order, so what is saved is what the last successful toggle asked for.
                void bridge.getUseSystemTitleBar().then(setUseSystemTitleBar);
                toastManager.add({ type: "error", title: "The setting could not be saved" });
              });
            }}
            aria-label="Use system title bar"
          />
        }
      />
      <SettingsRow
        {...searchableSetting("system-accent")}
        description={`The Kodo theme takes GNOME's accent colour. Other themes keep their own.${systemAccent === null ? " Your desktop does not report an accent colour." : ""}`}
        control={
          <Switch
            checked={followAccent}
            onCheckedChange={(checked) => setFollowSystemAccent(Boolean(checked))}
            aria-label="Follow the system accent colour"
          />
        }
      />
    </>
  );
}
