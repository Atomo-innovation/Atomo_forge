import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { StoredDetectionEvent } from "@/services/detectionEventsStore";

function formatDateTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(ts);
  }
}

export default function EventDetailDialog({
  open,
  onOpenChange,
  event,
  imageUrl,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: StoredDetectionEvent | null;
  imageUrl?: string;
  onDelete: (id: string) => void;
}) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const detailJson = useMemo(() => {
    if (!event) return "";
    const { cropImage: _b, ...rest } = event;
    return JSON.stringify(rest, null, 2);
  }, [event]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setConfirmDeleteOpen(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        {event && (
          <>
            <DialogHeader>
              <DialogTitle>{event.label}</DialogTitle>
              <DialogDescription>
                {event.cameraName} · {formatDateTime(event.createdAt)} · model {event.modelName}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-lg border border-border overflow-hidden bg-muted/30 flex items-center justify-center min-h-[200px] max-h-[55vh]">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={event.label}
                    className="max-w-full max-h-[55vh] w-auto h-auto object-contain"
                  />
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {imageUrl && (
                  <a
                    href={imageUrl}
                    download={`detection-${event.id}.jpg`}
                    className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                  >
                    Download JPEG
                  </a>
                )}
                <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
                  <AlertDialogTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-lg border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
                      onClick={() => setConfirmDeleteOpen(true)}
                    >
                      Delete event…
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this event?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This removes the event and its image from this browser&apos;s storage. Disk exports (if any) stay on
                        disk.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => {
                          onDelete(event.id);
                          setConfirmDeleteOpen(false);
                          onOpenChange(false);
                        }}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Stored fields (JSON)
                </div>
                <pre className="text-xs font-mono bg-muted/50 border border-border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
                  {detailJson}
                </pre>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

