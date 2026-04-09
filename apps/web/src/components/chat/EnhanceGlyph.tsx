import { useId } from "react";
import { cn } from "~/lib/utils";

export function EnhanceGlyph({
  className,
  monochrome = false,
}: {
  className?: string;
  monochrome?: boolean;
}) {
  const id = useId();
  const gradientId = `${id}-enhance-glyph-gradient`;

  if (monochrome) {
    return (
      <span
        aria-hidden="true"
        className={cn("relative grid size-6 shrink-0 place-items-center", className)}
      >
        <svg
          className="col-start-1 row-start-1 size-full"
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3.5">
            <ellipse cx="50" cy="50" rx="35" ry="12" transform="rotate(0, 50, 50)" />
            <ellipse cx="50" cy="50" rx="35" ry="12" transform="rotate(60, 50, 50)" />
            <ellipse cx="50" cy="50" rx="35" ry="12" transform="rotate(120, 50, 50)" />
          </g>
          <circle cx="50" cy="50" r="3" fill="currentColor" />
        </svg>
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn("relative grid size-6 shrink-0 place-items-center", className)}
    >
      <svg
        className="col-start-1 row-start-1 size-full transition-opacity duration-150 group-hover/enhance:opacity-0"
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#C8920A" stopOpacity={1} />
            <stop offset="50%" stopColor="#A67C10" stopOpacity={1} />
            <stop offset="100%" stopColor="#7A5C08" stopOpacity={1} />
          </linearGradient>
        </defs>
        <g fill="none" stroke={`url(#${gradientId})`} strokeLinecap="round" strokeWidth="2.5">
          <ellipse cx="50" cy="50" rx="35" ry="12" transform="rotate(0, 50, 50)" />
          <ellipse cx="50" cy="50" rx="35" ry="12" transform="rotate(60, 50, 50)" />
          <ellipse cx="50" cy="50" rx="35" ry="12" transform="rotate(120, 50, 50)" />
        </g>
        <circle cx="50" cy="50" r="3" fill={`url(#${gradientId})`} />
      </svg>
      <svg
        className="col-start-1 row-start-1 size-full opacity-0 transition-opacity duration-150 group-hover/enhance:opacity-100"
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5">
          <ellipse cx="50" cy="50" rx="35" ry="12" transform="rotate(0, 50, 50)" />
          <ellipse cx="50" cy="50" rx="35" ry="12" transform="rotate(60, 50, 50)" />
          <ellipse cx="50" cy="50" rx="35" ry="12" transform="rotate(120, 50, 50)" />
        </g>
        <circle cx="50" cy="50" r="3" fill="currentColor" />
      </svg>
    </span>
  );
}
