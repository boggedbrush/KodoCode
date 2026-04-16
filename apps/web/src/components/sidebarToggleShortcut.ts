import { useEffect, useMemo } from "react";

import { shouldShowThreadJumpHints, shortcutLabelForCommand } from "../keybindings";
import { isTerminalFocused } from "../lib/terminalFocus";
import { useServerKeybindings } from "../rpc/serverState";
import { useThreadJumpHintVisibility } from "./Sidebar.logic";

export function useSidebarToggleShortcutLabel(): string | null {
  const keybindings = useServerKeybindings();
  const platform = navigator.platform;
  const sidebarShortcutLabelOptions = useMemo(
    () => ({
      platform,
      context: {
        terminalFocus: false,
        terminalOpen: false,
      },
    }),
    [platform],
  );

  return useMemo(
    () => shortcutLabelForCommand(keybindings, "sidebar.toggle", sidebarShortcutLabelOptions),
    [keybindings, sidebarShortcutLabelOptions],
  );
}

export function useSidebarToggleShortcutHint(options?: { enabled?: boolean }): {
  showSidebarToggleShortcutHint: boolean;
  sidebarToggleShortcutLabel: string | null;
} {
  const enabled = options?.enabled ?? true;
  const keybindings = useServerKeybindings();
  const platform = navigator.platform;
  const sidebarToggleShortcutLabel = useSidebarToggleShortcutLabel();
  const { showThreadJumpHints, updateThreadJumpHintsVisibility } = useThreadJumpHintVisibility();

  useEffect(() => {
    if (!enabled) {
      updateThreadJumpHintsVisibility(false);
      return;
    }

    const getShortcutContext = () => ({
      terminalFocus: isTerminalFocused(),
      terminalOpen: false,
    });

    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      updateThreadJumpHintsVisibility(
        shouldShowThreadJumpHints(event, keybindings, {
          platform,
          context: getShortcutContext(),
        }),
      );
    };

    const onWindowKeyUp = (event: globalThis.KeyboardEvent) => {
      updateThreadJumpHintsVisibility(
        shouldShowThreadJumpHints(event, keybindings, {
          platform,
          context: getShortcutContext(),
        }),
      );
    };

    const onWindowBlur = () => {
      updateThreadJumpHintsVisibility(false);
    };

    window.addEventListener("keydown", onWindowKeyDown);
    window.addEventListener("keyup", onWindowKeyUp);
    window.addEventListener("blur", onWindowBlur);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
      window.removeEventListener("keyup", onWindowKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [enabled, keybindings, platform, updateThreadJumpHintsVisibility]);

  return {
    showSidebarToggleShortcutHint:
      enabled &&
      showThreadJumpHints &&
      sidebarToggleShortcutLabel !== null &&
      sidebarToggleShortcutLabel !== "",
    sidebarToggleShortcutLabel,
  };
}
