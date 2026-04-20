import type { ComponentType } from "react";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  CircleDashedIcon,
  GitBranchIcon,
  GaugeIcon,
  MonitorCogIcon,
  PaletteIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  WrenchIcon,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "~/lib/utils";
import { EnhanceGlyph } from "../chat/EnhanceGlyph";

import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "../ui/sidebar";

export type SettingsSectionPath =
  | "/settings/general"
  | "/settings/appearance"
  | "/settings/git"
  | "/settings/enhance"
  | "/settings/models"
  | "/settings/providers"
  | "/settings/usage"
  | "/settings/advanced"
  | "/settings/about"
  | "/settings/archived";

export const SETTINGS_NAV_ITEMS: ReadonlyArray<{
  label: string;
  to: SettingsSectionPath;
  icon: ComponentType<{ className?: string }>;
  iconClassName?: string;
}> = [
  { label: "General", to: "/settings/general", icon: Settings2Icon },
  { label: "Appearance", to: "/settings/appearance", icon: PaletteIcon },
  { label: "Git", to: "/settings/git", icon: GitBranchIcon },
  {
    label: "Enhance",
    to: "/settings/enhance",
    icon: ({ className }) => <EnhanceGlyph monochrome {...(className ? { className } : {})} />,
    iconClassName: "-ml-0.5 size-5",
  },
  { label: "Models", to: "/settings/models", icon: SlidersHorizontalIcon },
  { label: "Providers", to: "/settings/providers", icon: CircleDashedIcon },
  { label: "Usage", to: "/settings/usage", icon: GaugeIcon },
  { label: "Advanced", to: "/settings/advanced", icon: WrenchIcon },
  { label: "About", to: "/settings/about", icon: MonitorCogIcon },
  { label: "Archive", to: "/settings/archived", icon: ArchiveIcon },
];

export function SettingsSidebarNav({ pathname }: { pathname: string }) {
  const navigate = useNavigate();

  return (
    <>
      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup className="px-2 py-3">
          <SidebarMenu>
            {SETTINGS_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.to;
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    size="sm"
                    isActive={isActive}
                    className={
                      isActive
                        ? "gap-2 px-2 py-2 text-left text-xs text-foreground"
                        : "gap-2 px-2 py-2 text-left text-xs text-muted-foreground hover:text-foreground/80"
                    }
                    onClick={() => void navigate({ to: item.to, replace: true })}
                  >
                    <Icon
                      className={cn(
                        isActive
                          ? "size-4 shrink-0 text-foreground"
                          : "size-4 shrink-0 text-muted-foreground",
                        item.iconClassName,
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="sm"
              className="gap-2 px-2 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => window.history.back()}
            >
              <ArrowLeftIcon className="size-4" />
              <span>Back</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}
