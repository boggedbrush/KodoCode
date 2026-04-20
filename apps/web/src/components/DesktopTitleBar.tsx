import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useAppSettings } from "~/appSettings";
import { APP_BASE_NAME, APP_HERO_SRC, APP_STAGE_LABEL } from "../branding";
import { cn } from "../lib/utils";
import { useDesktopWindowFrame } from "./desktopWindowFrameState";
import { useSidebar } from "./ui/sidebar";

const DESKTOP_TITLEBAR_ACTIONS_SLOT_ID = "desktop-titlebar-actions-slot";
const DESKTOP_TITLEBAR_TITLE_SLOT_ID = "desktop-titlebar-title-slot";

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
  "flex h-11 w-10 items-center justify-center text-muted-foreground/60 transition-colors [-webkit-app-region:no-drag]";

export function DesktopWindowControls() {
  const { isMaximized } = useDesktopWindowFrame();

  return (
    <div className="flex h-full shrink-0 items-stretch justify-end">
      <button
        type="button"
        className={cn(windowControlButtonBase, "hover:bg-muted/60 hover:text-foreground/80")}
        onClick={() => window.desktopBridge?.windowControls?.minimize()}
        aria-label="Minimize window"
        tabIndex={-1}
      >
        <MinimizeIcon />
      </button>
      <button
        type="button"
        className={cn(windowControlButtonBase, "hover:bg-muted/60 hover:text-foreground/80")}
        onClick={() => window.desktopBridge?.windowControls?.toggleMaximize()}
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
        onClick={() => window.desktopBridge?.windowControls?.close()}
        aria-label="Close window"
        tabIndex={-1}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

export function DesktopTitleBarActionsPortal({ children }: { children: ReactNode }) {
  const { hasCustomTitlebar } = useDesktopWindowFrame();
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!hasCustomTitlebar) {
      setTarget(null);
      return;
    }

    setTarget(document.getElementById(DESKTOP_TITLEBAR_ACTIONS_SLOT_ID));
  }, [hasCustomTitlebar]);

  if (!hasCustomTitlebar || target === null) {
    return null;
  }

  return createPortal(children, target);
}

export function DesktopTitleBarTitlePortal({ children }: { children: ReactNode }) {
  const { hasCustomTitlebar } = useDesktopWindowFrame();
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!hasCustomTitlebar) {
      setTarget(null);
      return;
    }

    setTarget(document.getElementById(DESKTOP_TITLEBAR_TITLE_SLOT_ID));
  }, [hasCustomTitlebar]);

  if (!hasCustomTitlebar || target === null) {
    return null;
  }

  return createPortal(children, target);
}

export function DesktopTitleBar() {
  const brandRef = useRef<HTMLDivElement | null>(null);
  const { isMobile, open, toggleSidebar } = useSidebar();
  const { settings } = useAppSettings();
  const [brandWidth, setBrandWidth] = useState(0);

  useLayoutEffect(() => {
    const brandElement = brandRef.current;
    if (brandElement === null) {
      setBrandWidth(0);
      return;
    }

    const measure = () => {
      setBrandWidth(brandElement.getBoundingClientRect().width);
    };

    measure();

    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(brandElement);

    return () => {
      observer.disconnect();
    };
  }, []);

  const titleOffset =
    !isMobile && open && settings.sidebarSide === "left" && brandWidth > 0
      ? `max(0px, calc(var(--sidebar-width) - ${brandWidth}px))`
      : "0px";
  const sidebarToggleLabel = open ? "Hide sidebar" : "Show sidebar";

  return (
    <div
      className="drag-region flex h-11 w-full shrink-0 select-none items-center border-b border-border bg-background pr-0"
      role="banner"
      aria-label="Application title bar"
    >
      <div ref={brandRef} className="flex shrink-0 items-center gap-2 px-3">
        <button
          type="button"
          className="group/logo relative inline-flex size-7 shrink-0 items-center justify-center rounded-md outline-hidden transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring [-webkit-app-region:no-drag]"
          onClick={toggleSidebar}
          aria-label={sidebarToggleLabel}
          title={sidebarToggleLabel}
        >
          <span className="relative flex size-6 shrink-0 items-center justify-center">
            <img
              src={APP_HERO_SRC}
              alt=""
              aria-hidden="true"
              className="size-6 shrink-0 transition-opacity duration-150 group-hover/logo:opacity-0"
            />
            <span className="pointer-events-none absolute opacity-0 transition-opacity duration-150 group-hover/logo:opacity-100">
              {open ? <SidebarExpandedIcon /> : <SidebarCollapsedIcon />}
            </span>
          </span>
        </button>
        <span className="truncate text-xs font-semibold tracking-tight text-foreground">
          {APP_BASE_NAME}
        </span>
        <span className="shrink-0 rounded-full bg-muted/50 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
          {APP_STAGE_LABEL}
        </span>
      </div>

      <div
        id={DESKTOP_TITLEBAR_TITLE_SLOT_ID}
        className="flex min-w-0 flex-1 items-center"
        style={{ paddingLeft: titleOffset }}
      />
      <div
        id={DESKTOP_TITLEBAR_ACTIONS_SLOT_ID}
        className="ml-auto flex min-w-0 shrink-0 items-center gap-2 px-3 [-webkit-app-region:no-drag]"
      />
      <DesktopWindowControls />
    </div>
  );
}
