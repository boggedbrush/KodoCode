import { FolderIcon } from "lucide-react";
import type { FilesystemBrowseEntry } from "@t3tools/contracts";

import { cn } from "../lib/utils";
import { canNavigateUp, ensureBrowseDirectoryPath } from "../lib/projectPaths";

type ProjectFolderBrowserVariant = "sidebar" | "fullscreen";

export function ProjectFolderBrowser({
  variant,
  browsePath,
  browseEntries,
  browseCurrentDirectory,
  browseError,
  isBrowsingFilesystem,
  isAddingProject,
  onBrowsePathChange,
  onBrowse,
  onBrowseUp,
  onBrowseEntryOpen,
  onAddCurrentDirectory,
}: {
  variant: ProjectFolderBrowserVariant;
  browsePath: string;
  browseEntries: ReadonlyArray<FilesystemBrowseEntry>;
  browseCurrentDirectory: string | null;
  browseError: string | null;
  isBrowsingFilesystem: boolean;
  isAddingProject: boolean;
  onBrowsePathChange: (nextPath: string) => void;
  onBrowse: () => void;
  onBrowseUp: () => void;
  onBrowseEntryOpen: (entry: FilesystemBrowseEntry) => void;
  onAddCurrentDirectory: () => void;
}) {
  const isFullscreen = variant === "fullscreen";
  const canBrowseUp =
    browseCurrentDirectory !== null &&
    canNavigateUp(ensureBrowseDirectoryPath(browseCurrentDirectory)) &&
    !isBrowsingFilesystem;

  return (
    <div
      className={cn(
        "rounded-xl border border-border/80 bg-background/70",
        isFullscreen ? "flex min-h-0 flex-1 flex-col p-3" : "p-1.5",
      )}
    >
      <div className={cn("flex gap-2", isFullscreen ? "items-center" : "gap-1")}>
        <button
          type="button"
          className={cn(
            "shrink-0 rounded-md border border-border text-foreground/80 transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
            isFullscreen ? "px-3 py-2 text-xs" : "px-2 py-1 text-[11px]",
          )}
          onClick={onBrowseUp}
          disabled={!canBrowseUp}
        >
          Up
        </button>
        <input
          className={cn(
            "min-w-0 flex-1 rounded-md border bg-secondary font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none",
            browseError
              ? "border-red-500/70 focus:border-red-500"
              : "border-border focus:border-ring",
            isFullscreen ? "px-3 py-2 text-xs" : "px-2 py-1 text-[11px]",
          )}
          placeholder="~/code/"
          value={browsePath}
          onChange={(event) => onBrowsePathChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onBrowse();
            }
          }}
        />
        <button
          type="button"
          className={cn(
            "shrink-0 rounded-md border border-border text-foreground/80 transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
            isFullscreen ? "px-3 py-2 text-xs" : "px-2 py-1 text-[11px]",
          )}
          onClick={onBrowse}
          disabled={browsePath.trim().length === 0 || isBrowsingFilesystem}
        >
          {isBrowsingFilesystem ? "Loading..." : "Go"}
        </button>
      </div>

      {browseCurrentDirectory ? (
        <button
          type="button"
          className={cn(
            "mt-2 w-full rounded-md bg-secondary text-left text-foreground/80 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60",
            isFullscreen ? "px-3 py-2 text-xs" : "px-2 py-1.5 text-[11px]",
          )}
          onClick={onAddCurrentDirectory}
          disabled={isAddingProject}
          title={browseCurrentDirectory}
        >
          Add this folder: {browseCurrentDirectory}
        </button>
      ) : null}

      <div
        className={cn(
          "mt-2 overflow-y-auto rounded-md border border-border/60 bg-secondary/40",
          isFullscreen ? "min-h-0 flex-1" : "max-h-40",
        )}
      >
        {browseEntries.length === 0 ? (
          <p
            className={cn(
              "text-muted-foreground/70",
              isFullscreen ? "px-3 py-3 text-xs" : "px-2 py-2 text-[11px]",
            )}
          >
            {isBrowsingFilesystem ? "Loading folders..." : "No matching folders in this location."}
          </p>
        ) : (
          browseEntries.map((entry) => (
            <button
              key={entry.fullPath}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 text-left text-foreground/80 transition-colors hover:bg-accent hover:text-foreground",
                isFullscreen ? "px-3 py-2 text-xs" : "px-2 py-1.5 text-[11px]",
              )}
              onClick={() => onBrowseEntryOpen(entry)}
              title={entry.fullPath}
            >
              <FolderIcon className={cn("shrink-0", isFullscreen ? "size-4" : "size-3.5")} />
              <span className="truncate">{entry.name}</span>
            </button>
          ))
        )}
      </div>

      {browseError ? (
        <p
          className={cn(
            "mt-2 leading-tight text-red-400",
            isFullscreen ? "px-0.5 text-xs" : "px-0.5 text-[11px]",
          )}
        >
          {browseError}
        </p>
      ) : null}
    </div>
  );
}
