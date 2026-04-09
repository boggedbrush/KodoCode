import { Loader2Icon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";

import { Button } from "../ui/button";

export const EnhanceLoadingState = memo(function EnhanceLoadingState() {
  return (
    <Button
      type="button"
      size="icon"
      className={cn("rounded-full border-transparent text-white", "bg-[color:var(--color-accent)]")}
      disabled
      aria-label="Enhancing prompt"
      title="Enhancing prompt"
    >
      <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
    </Button>
  );
});
