import { cn } from "~/lib/utils";

export function EnhanceGlyph({
  className,
  monochrome = false,
}: {
  className?: string;
  monochrome?: boolean;
}) {
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
        className="col-start-1 row-start-1 size-full"
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
