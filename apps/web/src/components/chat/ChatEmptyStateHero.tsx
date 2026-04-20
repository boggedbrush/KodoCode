// FILE: ChatEmptyStateHero.tsx
// Purpose: Render the centered empty-state hero for blank transcripts.
// Layer: Chat presentation
// Depends on: the caller-supplied project display name.

import { memo } from "react";
import { APP_BASE_NAME, APP_HERO_SRC } from "../../branding";

export const ChatEmptyStateHero = memo(function ChatEmptyStateHero({
  projectName,
}: {
  projectName: string | undefined;
}) {
  return (
    <div className="flex flex-col items-center gap-5 select-none">
      <img
        alt={`${APP_BASE_NAME} logo`}
        className="size-14 rounded-lg object-contain"
        draggable={false}
        height={112}
        src={APP_HERO_SRC}
        width={112}
      />

      <div className="flex flex-col items-center gap-0.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground/90">Let's build</h1>
        {projectName && <span className="text-lg text-muted-foreground/40">{projectName}</span>}
      </div>
    </div>
  );
});
