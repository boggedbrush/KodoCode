import { NetworkIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { ComposerControl, ComposerControlIcon } from "../components/chat/ComposerControl";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useKodoSubAgentsStatus } from "./subAgentsStatus";

const ON_DESCRIPTION =
  "Sub-agents are on. This thread plans and delegates to workers: Code workers write, Review workers check, each on the model set for its mode (Settings, Models by mode).";
const OFF_DESCRIPTION =
  "Sub-agents are off. Turn them on and this thread leads workers instead of doing the work itself.";

/** The footer switch beside the mode chip: on or off, disabled with its reason when it cannot be flipped. */
export const KodoSubAgentsChip = memo(function KodoSubAgentsChip(props: { size?: "sm" | "xs" }) {
  const status = useKodoSubAgentsStatus();
  if (status === null) return null;
  const { toggle, onToggle } = status;
  const size = props.size ?? "sm";
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" data-kodo-sub-agents-trigger />}>
        <ComposerControl
          size={size}
          disabled={toggle.disabled}
          aria-pressed={toggle.checked}
          aria-label={`Sub-agents: ${toggle.checked ? "on" : "off"}`}
          data-kodo-sub-agents-chip={toggle.checked ? "on" : "off"}
          className={cn("ps-1.5", toggle.checked && "text-mode-code [&_svg]:text-mode-code!")}
          onClick={() => onToggle(!toggle.checked)}
        >
          <span className={cn("inline-flex items-center", size === "xs" ? "gap-1" : "gap-1.5")}>
            <ComposerControlIcon icon={NetworkIcon} size={size} />
            <span data-composer-control-label>Sub-agents</span>
          </span>
        </ComposerControl>
      </TooltipTrigger>
      <TooltipPopup side="top">
        {toggle.reason ?? (toggle.checked ? ON_DESCRIPTION : OFF_DESCRIPTION)}
      </TooltipPopup>
    </Tooltip>
  );
});
