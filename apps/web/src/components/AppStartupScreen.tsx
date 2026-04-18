import { APP_BASE_NAME, APP_STAGE_LABEL } from "../branding";
import devLogo from "../../../../assets/dev/blueprint.svg";
import prodLogo from "../../../../assets/prod/logo.svg";

const startupScreenLogo = import.meta.env.DEV ? devLogo : prodLogo;

export function AppStartupScreen({
  statusMessage = "Starting local backend…",
}: {
  readonly statusMessage?: string;
}) {
  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background px-6 py-10 text-foreground">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-64 bg-[radial-gradient(40rem_16rem_at_top,color-mix(in_srgb,var(--primary)_18%,transparent),transparent)] opacity-90" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_94%,var(--color-black))_0%,var(--background)_52%)]" />
        <div className="absolute inset-0 opacity-[0.035] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:2.75rem_2.75rem]" />
      </div>

      <div className="relative flex flex-col items-center gap-6 text-center">
        <div className="relative flex size-44 items-center justify-center sm:size-52">
          <div className="animate-startup-halo absolute inset-0 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--primary)_34%,transparent)_0%,transparent_70%)] blur-3xl" />
          <img
            src={startupScreenLogo}
            alt={`${APP_BASE_NAME} logo`}
            className="animate-startup-emblem relative size-32 select-none drop-shadow-[0_24px_80px_color-mix(in_srgb,var(--color-black)_28%,transparent)] sm:size-40"
            draggable={false}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2">
            <span className="text-sm font-semibold tracking-tight text-foreground">
              {APP_BASE_NAME}
            </span>
            <span className="rounded-full border border-border/70 bg-background/65 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {APP_STAGE_LABEL}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{statusMessage}</p>
        </div>
      </div>
    </div>
  );
}
