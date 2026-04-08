import { memo } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { INTERACTION_MODE_ACCENT_COLORS } from "../../modeColors";
import { cn } from "~/lib/utils";
import { type ReviewFocus, type ReviewRequestDraft, type ReviewTargetKind } from "../../review";

const REVIEW_TARGET_OPTIONS: Array<{ kind: ReviewTargetKind; label: string; description: string }> =
  [
    {
      kind: "uncommitted",
      label: "Uncommitted changes",
      description: "Review the current working tree state.",
    },
    {
      kind: "base-branch",
      label: "Base branch diff",
      description: "Compare against a named base branch.",
    },
    {
      kind: "upstream-base",
      label: "Upstream fork base",
      description: "Compare against an upstream tracking branch.",
    },
    {
      kind: "specific-diff",
      label: "Specific diff or patch",
      description: "Paste a diff or patch to review directly.",
    },
  ];

const REVIEW_FOCUS_OPTIONS: Array<{ value: ReviewFocus; label: string }> = [
  { value: "correctness", label: "Correctness" },
  { value: "regressions", label: "Regressions" },
  { value: "security", label: "Security" },
  { value: "performance", label: "Performance" },
  { value: "architecture", label: "Architecture" },
];

function toggleFocusValue(current: ReviewFocus[], focus: ReviewFocus): ReviewFocus[] {
  return current.includes(focus) ? current.filter((entry) => entry !== focus) : [...current, focus];
}

interface ReviewSetupDialogProps {
  open: boolean;
  draft: ReviewRequestDraft;
  isSubmitting: boolean;
  onChangeDraft: (next: ReviewRequestDraft) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export const ReviewSetupDialog = memo(function ReviewSetupDialog({
  open,
  draft,
  isSubmitting,
  onChangeDraft,
  onClose,
  onSubmit,
}: ReviewSetupDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Start review</DialogTitle>
          <DialogDescription>
            Choose what you want reviewed, add an optional focus, then send a structured review
            request.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="grid gap-2">
            <span className="text-xs font-medium text-foreground">Review target</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {REVIEW_TARGET_OPTIONS.map((option) => {
                const isActive = draft.targetKind === option.kind;
                return (
                  <button
                    key={option.kind}
                    type="button"
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left transition-colors",
                      isActive
                        ? "border-teal-500/60 bg-teal-500/10"
                        : "border-border/70 bg-background hover:bg-muted/30",
                    )}
                    onClick={() =>
                      onChangeDraft({
                        ...draft,
                        targetKind: option.kind,
                      })
                    }
                  >
                    <div className="text-sm font-medium">{option.label}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground/75">
                      {option.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">
              {draft.targetKind === "specific-diff" ? "Patch text" : "Target reference"}
            </span>
            {draft.targetKind === "specific-diff" ? (
              <Textarea
                value={draft.diffText ?? ""}
                onChange={(event) =>
                  onChangeDraft({
                    ...draft,
                    diffText: event.target.value,
                  })
                }
                placeholder="Paste the diff or patch you want reviewed"
                rows={8}
                spellCheck={false}
              />
            ) : (
              <Input
                value={draft.targetRef}
                onChange={(event) =>
                  onChangeDraft({
                    ...draft,
                    targetRef: event.target.value,
                  })
                }
                placeholder={
                  draft.targetKind === "base-branch"
                    ? "main"
                    : draft.targetKind === "upstream-base"
                      ? "origin/main"
                      : "Optional branch or ref"
                }
                spellCheck={false}
              />
            )}
          </label>

          <div className="grid gap-2">
            <span className="text-xs font-medium text-foreground">Review focus</span>
            <div className="flex flex-wrap gap-2">
              {REVIEW_FOCUS_OPTIONS.map((option) => {
                const isActive = draft.focus.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      isActive
                        ? "border-teal-500/60 bg-teal-500/10 text-teal-700 dark:text-teal-300"
                        : "border-border/70 bg-background text-muted-foreground hover:bg-muted/30",
                    )}
                    onClick={() =>
                      onChangeDraft({
                        ...draft,
                        focus: toggleFocusValue(draft.focus, option.value),
                      })
                    }
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onSubmit}
            disabled={isSubmitting}
            style={{
              backgroundColor: INTERACTION_MODE_ACCENT_COLORS.review,
              borderColor: INTERACTION_MODE_ACCENT_COLORS.review,
            }}
          >
            {isSubmitting ? "Starting..." : "Start review"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
});
