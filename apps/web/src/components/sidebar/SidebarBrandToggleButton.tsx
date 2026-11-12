import { PanelLeftCloseIcon, PanelLeftIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils";
import { T3Wordmark } from "../T3Wordmark";
import { Button } from "../ui/button";
import { useSidebar, useSidebarVisibility } from "../ui/sidebar";

/**
 * The sidebar toggle, drawn as the app's emblem. Hovering or focusing it morphs the emblem
 * into the collapse or expand glyph, so the brand stays visible without a second control.
 * It mirrors `SidebarTrigger`'s data attributes, which tests and styles key on.
 */
export function SidebarBrandToggleButton({
  className,
  onClick,
  ...props
}: ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar();
  const isOpen = useSidebarVisibility();
  const ActionIcon = isOpen ? PanelLeftCloseIcon : PanelLeftIcon;

  return (
    <Button
      className={cn(
        "group size-[var(--workspace-titlebar-control-size)]! [-webkit-app-region:no-drag]",
        className,
      )}
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      aria-pressed={isOpen}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      size="icon"
      variant="ghost"
      {...props}
    >
      <span className="relative flex size-4 items-center justify-center">
        <T3Wordmark
          aria-hidden
          className="size-4 text-foreground transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0"
        />
        <ActionIcon
          aria-hidden
          className="absolute inset-0 size-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </span>
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
}
