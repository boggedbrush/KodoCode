import { cn } from "../lib/utils";
import { useSidebar } from "./ui/sidebar";
import devLogo from "../../../../assets/dev/blueprint.svg";
import prodLogo from "../../../../assets/prod/logo.svg";

const sidebarWordmarkLogo = import.meta.env.DEV ? devLogo : prodLogo;

function SidebarCollapseGlyph() {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className="size-full">
      <rect
        x="12"
        y="15"
        width="24"
        height="18"
        rx="4.5"
        ry="4.5"
        stroke="currentColor"
        strokeWidth="2.2"
        fill="none"
      />
      <line
        x1="18"
        y1="21"
        x2="18"
        y2="27"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SidebarExpandGlyph() {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className="size-full">
      <rect
        x="12"
        y="15"
        width="24"
        height="18"
        rx="4.5"
        ry="4.5"
        stroke="currentColor"
        strokeWidth="2.2"
        fill="none"
      />
      <line
        x1="19.5"
        y1="18.5"
        x2="19.5"
        y2="29.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SidebarBrandToggleButton({ className }: { className?: string }) {
  const { open: sidebarOpen, toggleSidebar } = useSidebar();

  return (
    <button
      type="button"
      aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
      data-testid="sidebar-brand-toggle"
      tabIndex={sidebarOpen ? -1 : undefined}
      className={cn(
        "group inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 outline-hidden ring-ring transition-[width,opacity,color,background-color] duration-200 ease-linear hover:bg-accent hover:text-foreground focus-visible:ring-2 [-webkit-app-region:no-drag]",
        sidebarOpen && "w-0 overflow-hidden opacity-0",
        className,
      )}
      onClick={toggleSidebar}
    >
      <span className="relative flex size-6 shrink-0 items-center justify-center">
        <img
          src={sidebarWordmarkLogo}
          alt=""
          aria-hidden="true"
          className="size-6 transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0"
        />
        <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
          {sidebarOpen ? <SidebarCollapseGlyph /> : <SidebarExpandGlyph />}
        </span>
      </span>
    </button>
  );
}
