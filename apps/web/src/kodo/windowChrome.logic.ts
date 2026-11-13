import type { KodoWindowChromeState } from "@t3tools/contracts";

// libadwaita's window controls: 24px round buttons, 6px apart, 6px from the bar's edge.
const BUTTON_SIZE = 24;
const BUTTON_GAP = 6;
const GROUP_PADDING = 6;

/** The width one side of the header bar needs for its buttons, which the headers beside it leave free. */
export function windowControlsWidth(buttonCount: number): number {
  if (buttonCount <= 0) return 0;
  return buttonCount * BUTTON_SIZE + (buttonCount - 1) * BUTTON_GAP + 2 * GROUP_PADDING;
}

export type KodoWindowStateName = "normal" | "maximized" | "fullscreen";

export function windowStateName(
  state: Pick<KodoWindowChromeState, "maximized" | "fullscreen">,
): KodoWindowStateName {
  return state.fullscreen ? "fullscreen" : state.maximized ? "maximized" : "normal";
}

/** Maximize is also restore, and from fullscreen it leaves fullscreen. */
export function maximizeButtonLabel(
  state: Pick<KodoWindowChromeState, "maximized" | "fullscreen">,
): "Maximize" | "Restore" {
  return state.maximized || state.fullscreen ? "Restore" : "Maximize";
}
