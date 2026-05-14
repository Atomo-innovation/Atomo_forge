import { useEffect, useId, useRef, useState } from "react";
import type { CameraConfig } from "@/pages/Dashboard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAX_NAME_LENGTH = 80;

export interface RenameCameraDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  camera: CameraConfig | null;
  onSave: (cameraId: string, name: string) => void;
}

export function RenameCameraDialog({ open, onOpenChange, camera, onSave }: RenameCameraDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !camera) return;
    setValue(camera.name);
    setError(null);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open, camera?.id, camera?.name]);

  const trimmed = value.trim();
  const unchanged = Boolean(camera && trimmed === camera.name);
  const canSave = Boolean(camera && trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH);

  const applySave = () => {
    if (!camera) return;
    const next = value.trim();
    if (!next) {
      setError("Enter a display name for this camera.");
      return;
    }
    if (next.length > MAX_NAME_LENGTH) {
      setError(`Use at most ${MAX_NAME_LENGTH} characters.`);
      return;
    }
    if (next === camera.name) {
      onOpenChange(false);
      return;
    }
    onSave(camera.id, next);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 sm:max-w-md">
        <DialogHeader className="gap-1 space-y-0 pb-2 pr-8">
          <DialogTitle>Rename camera</DialogTitle>
          <DialogDescription className="text-left leading-relaxed">
            Update how this camera appears in the overview, workspace lists, live view, and detection events. Connection
            settings are not changed.
          </DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          className="grid gap-4 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            applySave();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={`${formId}-name`} className="text-foreground">
              Display name
            </Label>
            <Input
              ref={inputRef}
              id={`${formId}-name`}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. Lobby — north"
              maxLength={MAX_NAME_LENGTH + 16}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${formId}-err` : `${formId}-hint`}
              className={error ? "border-destructive focus-visible:ring-destructive/40" : undefined}
            />
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span id={`${formId}-hint`}>Letters, numbers, and spaces are fine.</span>
              <span className="tabular-nums text-muted-foreground/80">
                {Math.min(value.length, MAX_NAME_LENGTH)}/{MAX_NAME_LENGTH}
              </span>
            </div>
            {error ? (
              <p id={`${formId}-err`} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </form>
        <DialogFooter className="gap-2 pt-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={!canSave}>
            {unchanged ? "Done" : "Save name"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
