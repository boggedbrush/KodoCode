import { APP_BASE_NAME, APP_STAGE_LABEL } from "../branding";
import { readDesktopBridge } from "../desktopRuntime";
import { cn } from "../lib/utils";
import { useDesktopWindowFrame } from "./desktopWindowFrameState";
import devLogo from "../../../../assets/dev/blueprint.svg";
import prodLogo from "../../../../assets/prod/logo.svg";

function MinimizeIcon() {
  return (
    <svg viewBox="0 0 10 10" fill="none" aria-hidden="true" className="size-2.5">
      <path d="M1 5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg viewBox="0 0 10 10" fill="none" aria-hidden="true" className="size-2.5">
      <rect x="1" y="1" width="8" height="8" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg viewBox="0 0 10 10" fill="none" aria-hidden="true" className="size-2.5">
      <rect x="3" y="1" width="6" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M1 3.5V9h5.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 10 10" fill="none" aria-hidden="true" className="size-2.5">
      <path
        d="M1.5 1.5l7 7M8.5 1.5l-7 7"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

const windowControlButtonBase =
  "flex h-full w-10 items-center justify-center text-muted-foreground/60 transition-colors [-webkit-app-region:no-drag]";
const linuxTitleBarLogo = import.meta.env.DEV ? devLogo : prodLogo;
const handleMinimize = () => {
  readDesktopBridge()?.windowControls.minimize();
};
const handleToggleMaximize = () => {
  readDesktopBridge()?.windowControls.toggleMaximize();
};
const handleClose = () => {
  readDesktopBridge()?.windowControls.close();
};

export function LinuxTitleBar() {
  const { isMaximized } = useDesktopWindowFrame();

  return (
    <div
      className="drag-region flex h-9 w-full shrink-0 select-none items-center border-b border-border bg-background"
      role="banner"
      aria-label="Application title bar"
    >
      {/* Left: logo + app name. Keep this area draggable; only the buttons are no-drag. */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 px-3">
        <img src={linuxTitleBarLogo} alt="" aria-hidden="true" className="size-5 shrink-0" />
        <span className="truncate text-xs font-semibold tracking-tight text-foreground">
          {APP_BASE_NAME}
        </span>
        <span className="shrink-0 rounded-full bg-muted/50 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
          {APP_STAGE_LABEL}
        </span>
      </div>

      {/* Right: window controls */}
      <div className="flex h-full shrink-0 items-stretch">
        <button
          type="button"
          className={cn(windowControlButtonBase, "hover:bg-muted/60 hover:text-foreground/80")}
          onClick={handleMinimize}
          aria-label="Minimize window"
          tabIndex={-1}
        >
          <MinimizeIcon />
        </button>
        <button
          type="button"
          className={cn(windowControlButtonBase, "hover:bg-muted/60 hover:text-foreground/80")}
          onClick={handleToggleMaximize}
          aria-label={isMaximized ? "Restore window" : "Maximize window"}
          tabIndex={-1}
        >
          {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button
          type="button"
          className={cn(
            windowControlButtonBase,
            "hover:bg-red-500/15 hover:text-red-400 dark:hover:bg-red-500/20 dark:hover:text-red-400",
          )}
          onClick={handleClose}
          aria-label="Close window"
          tabIndex={-1}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
