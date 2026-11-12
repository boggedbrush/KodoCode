import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

const MODE_ACTION_TONES = {
  plan: "border-mode-plan/40 bg-mode-plan/4 text-mode-plan hover:bg-mode-plan/10",
} as const;

/** A compact banner action tinted with an interaction mode's accent, with that mode's icon. */
export function KodoModeActionButton(props: {
  readonly mode: keyof typeof MODE_ACTION_TONES;
  readonly icon: LucideIcon;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={`inline-flex h-7 shrink-0 cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 font-medium text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-64 sm:h-6 sm:text-xs ${MODE_ACTION_TONES[props.mode]}`}
    >
      <Icon aria-hidden className="size-4 shrink-0 sm:size-3.5" />
      {props.children}
    </button>
  );
}
