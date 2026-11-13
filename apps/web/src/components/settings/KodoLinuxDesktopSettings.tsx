import { useEffect, useState } from "react";

import { isElectron } from "../../env";
import { setFollowSystemAccent, useFollowSystemAccent } from "../../kodo/systemAccent";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { searchableSetting } from "./settingsSearch";
import { SettingsRow } from "./settingsLayout";

/**
 * The Linux desktop app's GNOME settings: whether the window draws its own header buttons or keeps the
 * system title bar, and whether the Kodo theme follows the desktop's accent colour. Nothing renders
 * elsewhere, where the bridge has no Linux part.
 */
export function KodoLinuxDesktopSettings() {
  const bridge = isElectron ? window.desktopBridge?.kodoLinuxDesktop : undefined;
  const [useSystemTitleBar, setUseSystemTitleBar] = useState<boolean | null>(null);
  const followAccent = useFollowSystemAccent();

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
        description="On GNOME, Kodo Code draws the window buttons in its own header bar, as your button layout says. Turn this on to keep the system title bar. Applies at next start."
        control={
          <Switch
            checked={useSystemTitleBar === true}
            disabled={useSystemTitleBar === null}
            onCheckedChange={(checked) => {
              const next = Boolean(checked);
              setUseSystemTitleBar(next);
              bridge.setUseSystemTitleBar(next).catch(() => {
                setUseSystemTitleBar(!next);
                toastManager.add({ type: "error", title: "The setting could not be saved" });
              });
            }}
            aria-label="Use system title bar"
          />
        }
      />
      {bridge.getSystemAccent() !== null || !followAccent ? (
        <SettingsRow
          {...searchableSetting("system-accent")}
          description="The Kodo theme takes GNOME's accent colour. Other themes keep their own."
          control={
            <Switch
              checked={followAccent}
              onCheckedChange={(checked) => setFollowSystemAccent(Boolean(checked))}
              aria-label="Follow the system accent colour"
            />
          }
        />
      ) : null}
    </>
  );
}
