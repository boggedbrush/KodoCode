import { TriangleAlertIcon } from "lucide-react";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import {
  KODO_ORCHESTRATOR_STATE_LABEL,
  type KodoOrchestratorState,
} from "@t3tools/shared/kodoOrchestrator";
import { KODO_ORCHESTRATOR_DOT_CLASS } from "./orchestrator.logic";
import { useKodoOrchestrator } from "./useKodoOrchestrator";

/** The status dot: a static colour, three states, announced by its label rather than its hue. */
function KodoOrchestratorDot(props: { readonly state: KodoOrchestratorState }) {
  return (
    <span
      aria-hidden
      data-kodo-orchestrator-dot={props.state}
      className={`size-2 shrink-0 rounded-full ${KODO_ORCHESTRATOR_DOT_CLASS[props.state]}`}
    />
  );
}

/**
 * The first row of the thread list, in the part of the sidebar that does not scroll: one
 * conversation across all projects, with a dot that says whether it is idle, working or needs you.
 */
export function KodoOrchestratorRow() {
  const orchestrator = useKodoOrchestrator();
  if (!orchestrator.visible) return null;
  const label = KODO_ORCHESTRATOR_STATE_LABEL[orchestrator.state];
  const button = (
    <SidebarMenuButton
      isActive={orchestrator.active}
      disabled={orchestrator.opening}
      aria-label={`Orchestrator, ${label}`}
      onClick={orchestrator.open}
    >
      <KodoOrchestratorDot state={orchestrator.state} />
      <span className="min-w-0 flex-1 truncate">Orchestrator</span>
      {orchestrator.unavailable === null ? null : (
        <TriangleAlertIcon
          aria-hidden
          data-kodo-orchestrator-unavailable
          className="size-3.5 shrink-0 text-warning"
        />
      )}
      <span className="sr-only">{label}</span>
    </SidebarMenuButton>
  );
  return (
    <SidebarMenu data-kodo-orchestrator-row>
      <SidebarMenuItem>
        {orchestrator.unavailable === null ? (
          button
        ) : (
          <Tooltip>
            <TooltipTrigger render={button} />
            <TooltipPopup side="right">{orchestrator.unavailable}</TooltipPopup>
          </Tooltip>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/**
 * With the sidebar collapsed the dot alone stays at the top left, on the sidebar toggle's corner. It opens
 * the Orchestrator like the row does; it is not drawn while the sidebar shows the row.
 */
export function KodoOrchestratorCollapsedDot() {
  const orchestrator = useKodoOrchestrator();
  if (!orchestrator.visible) return null;
  const label = KODO_ORCHESTRATOR_STATE_LABEL[orchestrator.state];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-kodo-orchestrator-collapsed
            aria-label={`Open the Orchestrator, ${label}`}
            disabled={orchestrator.opening}
            onClick={orchestrator.open}
            className="pointer-events-auto absolute bottom-0.5 left-[calc(var(--workspace-titlebar-control-size)-0.375rem)] flex size-4 items-center justify-center rounded-full bg-background outline-none ring-1 ring-border focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [-webkit-app-region:no-drag]"
          />
        }
      >
        <KodoOrchestratorDot state={orchestrator.state} />
      </TooltipTrigger>
      <TooltipPopup side="bottom">Orchestrator, {label}</TooltipPopup>
    </Tooltip>
  );
}
