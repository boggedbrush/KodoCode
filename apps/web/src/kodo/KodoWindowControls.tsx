import type { KodoWindowButton, KodoWindowChromeState } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { useKodoWindowChrome } from "./windowChrome";
import { maximizeButtonLabel } from "./windowChrome.logic";

// Symbolic icons at 16px, 1.5px strokes, as in Adwaita's window controls.
const ICONS: Record<"minimize" | "maximize" | "restore" | "close", ReactNode> = {
  minimize: <path d="M3.5 8h9" />,
  maximize: <rect x="3.5" y="3.5" width="9" height="9" rx="1" />,
  restore: (
    <>
      <rect x="3.5" y="5.5" width="7" height="7" rx="1" />
      <path d="M5.5 5.5V4.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
    </>
  ),
  close: <path d="m4 4 8 8m0-8-8 8" />,
};

function WindowButton({
  button,
  state,
}: {
  readonly button: KodoWindowButton;
  readonly state: KodoWindowChromeState;
}) {
  const label =
    button === "maximize" ? maximizeButtonLabel(state) : button === "close" ? "Close" : "Minimize";
  const icon = button === "maximize" ? (label === "Restore" ? "restore" : "maximize") : button;
  return (
    <button
      type="button"
      className="pointer-events-auto inline-flex size-6 items-center justify-center rounded-full bg-current/10 text-(--toolbar-foreground) outline-ring hover:bg-current/15 focus-visible:outline-2 active:bg-current/20 [-webkit-app-region:no-drag]"
      data-kodo-window-button={button}
      aria-label={label}
      onClick={() => void window.desktopBridge?.kodoLinuxDesktop?.runWindowAction(button)}
    >
      <svg
        viewBox="0 0 16 16"
        width="16"
        height="16"
        aria-hidden
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ICONS[icon]}
      </svg>
    </button>
  );
}

/**
 * The header bar's window buttons, drawn when the Linux desktop window has no system frame, on the sides
 * and in the order of GNOME's button layout. The headers' own drag regions sit behind them.
 */
export function KodoWindowControls() {
  const state = useKodoWindowChrome();
  if (state === null) return null;
  return (
    <>
      {(["left", "right"] as const).map((side) =>
        state[side].length === 0 ? null : (
          <div
            key={side}
            className={`pointer-events-none fixed top-0 z-[60] flex h-(--workspace-topbar-height) items-center gap-1.5 px-1.5 [-webkit-app-region:no-drag] ${side === "left" ? "left-0" : "right-0"}`}
            data-kodo-window-controls={side}
          >
            {state[side].map((button) => (
              <WindowButton key={button} button={button} state={state} />
            ))}
          </div>
        ),
      )}
    </>
  );
}
