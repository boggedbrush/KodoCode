import { APP_BASE_NAME, APP_STAGE_LABEL } from "../branding";
import { cn } from "../lib/utils";
import { useSidebarToggleShortcutHint } from "./sidebarToggleShortcut";
import { useDesktopWindowFrame } from "./desktopWindowFrameState";
import { useSidebar } from "./ui/sidebar";
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

function SidebarExpandedIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="size-3.5">
      <rect
        x="2.5"
        y="3"
        width="11"
        height="10"
        rx="1.75"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M6 3v10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function SidebarCollapsedIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="size-3.5">
      <rect
        x="2.5"
        y="3"
        width="11"
        height="10"
        rx="1.75"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M5.5 3v10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

const windowControlButtonBase =
  "flex h-9 w-10 items-center justify-center text-muted-foreground/60 transition-colors [-webkit-app-region:no-drag]";
const linuxTitleBarLogo = import.meta.env.DEV ? devLogo : prodLogo;
const handleMinimize = () => {
  window.desktopBridge?.windowControls.minimize();
};
const handleToggleMaximize = () => {
  window.desktopBridge?.windowControls.toggleMaximize();
};
const handleClose = () => {
  window.desktopBridge?.windowControls.close();
};

/**
 * The three Linux window control buttons (minimize, maximize/restore, close).
 * Rendered at the trailing edge of whichever header acts as the titlebar for
 * the current view, mirroring how macOS traffic lights sit at the leading edge.
 */
export function LinuxWindowControls() {
  const { isMaximized } = useDesktopWindowFrame();
  return (
    <div className="-mr-3 ms-auto flex shrink-0 items-center self-stretch pl-2 sm:-mr-5">
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
  );
}

export function LinuxTitleBar() {
  const { open: sidebarOpen, toggleSidebar } = useSidebar();
  const { showSidebarToggleShortcutHint, sidebarToggleShortcutLabel } =
    useSidebarToggleShortcutHint();
  const sidebarToggleLabel = sidebarOpen ? "Hide sidebar" : "Show sidebar";

  return (
    <div
      className="drag-region flex h-9 w-full shrink-0 select-none items-center border-b border-border bg-background"
      role="banner"
      aria-label="Application title bar"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
        <button
          type="button"
          className="group/logo relative inline-flex size-6 shrink-0 items-center justify-center rounded-md outline-hidden transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring [-webkit-app-region:no-drag]"
          onClick={toggleSidebar}
          aria-label={
            sidebarToggleShortcutLabel
              ? `${sidebarToggleLabel} (${sidebarToggleShortcutLabel})`
              : sidebarToggleLabel
          }
          title={
            sidebarToggleShortcutLabel
              ? `${sidebarToggleLabel} (${sidebarToggleShortcutLabel})`
              : sidebarToggleLabel
          }
        >
          <span
            className={cn(
              "relative flex size-5 shrink-0 items-center justify-center",
              showSidebarToggleShortcutHint && "opacity-0",
            )}
          >
            <img
              src={linuxTitleBarLogo}
              alt=""
              aria-hidden="true"
              className="size-5 shrink-0 transition-opacity duration-150 group-hover/logo:opacity-0 group-focus-visible/logo:opacity-0"
            />
            <span className="pointer-events-none absolute opacity-0 transition-opacity duration-150 group-hover/logo:opacity-100 group-focus-visible/logo:opacity-100">
              {sidebarOpen ? <SidebarExpandedIcon /> : <SidebarCollapsedIcon />}
            </span>
          </span>
          {showSidebarToggleShortcutHint ? (
            <span
              className="pointer-events-none absolute top-1/2 left-1/2 inline-flex h-5 -translate-x-1/2 -translate-y-1/2 items-center rounded-full border border-border/80 bg-background/90 px-1.5 font-mono text-[10px] font-medium tracking-tight text-foreground whitespace-nowrap shadow-sm"
              title={sidebarToggleShortcutLabel ?? undefined}
            >
              {sidebarToggleShortcutLabel}
            </span>
          ) : null}
        </button>
        <span className="truncate text-xs font-semibold tracking-tight text-foreground">
          {APP_BASE_NAME}
        </span>
        <span className="shrink-0 rounded-full bg-muted/50 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
          {APP_STAGE_LABEL}
        </span>
      </div>

      <LinuxWindowControls />
    </div>
  );
}
