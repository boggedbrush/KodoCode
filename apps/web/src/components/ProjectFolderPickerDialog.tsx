import type { FilesystemBrowseEntry } from "@t3tools/contracts";

import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "./ui/dialog";
import { ProjectFolderBrowser } from "./ProjectFolderBrowser";

export function ProjectFolderPickerDialog({
  open,
  newCwd,
  addProjectError,
  canAddProject,
  isAddingProject,
  browsePath,
  browseEntries,
  browseCurrentDirectory,
  browseError,
  isBrowsingFilesystem,
  onOpenChange,
  onNewCwdChange,
  onAddProject,
  onBrowsePathChange,
  onBrowse,
  onBrowseUp,
  onBrowseEntryOpen,
  onAddCurrentDirectory,
}: {
  open: boolean;
  newCwd: string;
  addProjectError: string | null;
  canAddProject: boolean;
  isAddingProject: boolean;
  browsePath: string;
  browseEntries: ReadonlyArray<FilesystemBrowseEntry>;
  browseCurrentDirectory: string | null;
  browseError: string | null;
  isBrowsingFilesystem: boolean;
  onOpenChange: (open: boolean) => void;
  onNewCwdChange: (nextPath: string) => void;
  onAddProject: () => void;
  onBrowsePathChange: (nextPath: string) => void;
  onBrowse: () => void;
  onBrowseUp: () => void;
  onBrowseEntryOpen: (entry: FilesystemBrowseEntry) => void;
  onAddCurrentDirectory: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="h-[min(88vh,56rem)] max-w-[min(96vw,72rem)]">
        <DialogHeader>
          <DialogTitle>Add Project</DialogTitle>
          <DialogDescription>
            Browse to a folder or paste a path directly. The same filesystem browser powers both
            picker layouts so appearance settings only change presentation, not behavior.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 pb-6">
          <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
              Project path
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className={`min-w-0 flex-1 rounded-md border bg-secondary px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none ${
                  addProjectError
                    ? "border-red-500/70 focus:border-red-500"
                    : "border-border focus:border-ring"
                }`}
                placeholder="/path/to/project"
                value={newCwd}
                onChange={(event) => onNewCwdChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    onAddProject();
                  }
                }}
                autoFocus
              />
              <button
                type="button"
                className="shrink-0 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 disabled:opacity-60"
                onClick={onAddProject}
                disabled={!canAddProject}
              >
                {isAddingProject ? "Adding..." : "Add project"}
              </button>
            </div>
            {addProjectError ? (
              <p className="mt-2 px-0.5 text-xs leading-tight text-red-400">{addProjectError}</p>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <ProjectFolderBrowser
              variant="fullscreen"
              browsePath={browsePath}
              browseEntries={browseEntries}
              browseCurrentDirectory={browseCurrentDirectory}
              browseError={browseError}
              isBrowsingFilesystem={isBrowsingFilesystem}
              isAddingProject={isAddingProject}
              onBrowsePathChange={onBrowsePathChange}
              onBrowse={onBrowse}
              onBrowseUp={onBrowseUp}
              onBrowseEntryOpen={onBrowseEntryOpen}
              onAddCurrentDirectory={onAddCurrentDirectory}
            />
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
