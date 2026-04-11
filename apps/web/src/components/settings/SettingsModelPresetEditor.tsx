import { useEffect, useState } from "react";

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

export function SettingsModelPresetEditor({
  open,
  title,
  description,
  confirmLabel,
  initialValue,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  initialValue: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
    }
  }, [initialValue, open]);

  const trimmedValue = value.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <Input
            autoFocus
            aria-label="Preset name"
            placeholder="Preset name"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && trimmedValue.length > 0) {
                onSubmit(trimmedValue);
                onOpenChange(false);
              }
            }}
          />
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={trimmedValue.length === 0}
            onClick={() => {
              onSubmit(trimmedValue);
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
