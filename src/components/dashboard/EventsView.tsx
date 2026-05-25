import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Search, CalendarDays, LayoutGrid, List } from "lucide-react";
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
import {
  clearAllDetectionEvents,
  deleteDetectionEvent,
  getDetectionEventById,
  type StoredDetectionEvent,
} from "@/services/detectionEventsStore";
import { useDetectionEvents } from "@/hooks/useDetectionEvents";
import { loadDetectionEventThumbUrls, revokeThumbUrls } from "@/services/detectionEventThumbs";
import { useModels } from "@/hooks/useModels";
import { getCameraSnapshot } from "@/services/cameraRegistry";
import type { CameraConfig } from "@/pages/Dashboard";

const PAGE_SIZE = 8;

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

const EventDetailDialog = lazy(() => import("@/components/dashboard/EventDetailDialog"));

const EventsView = ({ cameras }: { cameras: CameraConfig[] }) => {
  const { events, loading } = useDetectionEvents();
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const thumbUrlsRef = useRef<Record<string, string>>({});
  const [detailEvent, setDetailEvent] = useState<StoredDetectionEvent | null>(null);
  const [query, setQuery] = useState("");
  const [service, setService] = useState<string>("all");
  const [camera, setCamera] = useState<string>("all");
  const [dateRange, setDateRange] = useState<string>("");
  const [page, setPage] = useState(1);
  const [layout, setLayout] = useState<"table" | "gallery">("table");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmClearAllOpen, setConfirmClearAllOpen] = useState(false);
  const { models } = useModels();

  const rows = useMemo(() => {
    const cameraById = new Map<string, { name: string; model?: string; inferenceModelId?: string }>();
    cameras.forEach((c) => cameraById.set(c.id, { name: c.name, model: c.model, inferenceModelId: c.inferenceModelId }));
    const modelNameById = new Map<string, string>();
    models.forEach((m) => modelNameById.set(m.id, m.name));

    return events.map((e) => {
      const pct = typeof e.score === "number" ? `${(e.score * 100).toFixed(1)}%` : "—";
      const details = `Score ${pct} · session ${e.sessionId.slice(0, 8)}…`;
      const severity: "normal" | "danger" = typeof e.score === "number" && e.score < 0.35 ? "danger" : "normal";
      const liveCam = cameraById.get(e.cameraId);
      const reg = getCameraSnapshot(e.cameraId);
      const cameraNameResolved = liveCam?.name ?? reg?.name ?? e.cameraName ?? "—";
      const storedModelOk = typeof e.modelName === "string" && e.modelName.trim() && e.modelName.trim() !== "—";
      const modelId = (e as any).modelId as string | undefined;
      const modelFromId = modelId ? modelNameById.get(modelId) : undefined;
      const regModelOk = typeof reg?.modelName === "string" && reg.modelName.trim() && reg.modelName.trim() !== "—";
      const modelNameResolved = storedModelOk
        ? e.modelName
        : modelFromId ??
          (regModelOk ? reg!.modelName : undefined) ??
          liveCam?.model ??
          (modelId || reg?.modelId || liveCam?.inferenceModelId) ??
          "—";
      return {
        id: e.id,
        eventName: e.label,
        details,
        serviceName: modelNameResolved,
        cameraName: cameraNameResolved,
        dateTime: formatDateTime(e.createdAt),
        severity,
        thumbUrl: thumbUrls[e.id],
      };
    });
  }, [cameras, events, models, thumbUrls]);

  const serviceOptions = useMemo(() => {
    const modelNameById = new Map<string, string>();
    models.forEach((m) => modelNameById.set(m.id, m.name));

    const fromEvents = rows.map((r) => r.serviceName).filter(Boolean);
    const fromCameras = cameras
      .map((c) => c.model ?? (c.inferenceModelId ? modelNameById.get(c.inferenceModelId) ?? c.inferenceModelId : undefined))
      .filter(Boolean);

    const unique = Array.from(new Set([...fromCameras, ...fromEvents].map((s) => String(s).trim()).filter(Boolean)));
    return ["all", ...unique];
  }, [cameras, models, rows]);

  const cameraOptions = useMemo(() => {
    const fromEvents = rows.map((r) => r.cameraName).filter(Boolean);
    const fromCameras = cameras.map((c) => c.name).filter(Boolean);
    const unique = Array.from(new Set([...fromCameras, ...fromEvents].map((s) => String(s).trim()).filter(Boolean)));
    return ["all", ...unique];
  }, [cameras, rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const matchesQuery =
        !q || `${r.eventName} ${r.details} ${r.serviceName} ${r.cameraName}`.toLowerCase().includes(q);
      const matchesService = service === "all" || r.serviceName === service;
      const matchesCamera = camera === "all" || r.cameraName === camera;
      const dr = dateRange.trim().toLowerCase();
      const matchesDateRange = !dr || r.dateTime.toLowerCase().includes(dr);
      return matchesQuery && matchesService && matchesCamera && matchesDateRange;
    });
  }, [query, service, camera, dateRange, rows]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageSlice = useMemo(() => {
    const p = Math.min(page, totalPages);
    const start = (p - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page, totalPages]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const visibleThumbIds = useMemo(() => {
    const ids = pageSlice.map((r) => r.id);
    if (detailId) ids.push(detailId);
    return ids;
  }, [pageSlice, detailId]);

  useEffect(() => {
    let cancelled = false;
    void loadDetectionEventThumbUrls(visibleThumbIds).then((loaded) => {
      if (cancelled) {
        revokeThumbUrls(loaded);
        return;
      }
      const prev = thumbUrlsRef.current;
      const next: Record<string, string> = {};
      for (const id of visibleThumbIds) {
        const url = loaded[id] ?? prev[id];
        if (url) next[id] = url;
      }
      for (const [id, url] of Object.entries(prev)) {
        if (!visibleThumbIds.includes(id)) URL.revokeObjectURL(url);
      }
      thumbUrlsRef.current = next;
      setThumbUrls(next);
    });
    return () => {
      cancelled = true;
    };
  }, [visibleThumbIds]);

  useEffect(() => {
    return () => {
      revokeThumbUrls(thumbUrlsRef.current);
      thumbUrlsRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!detailId) {
      setDetailEvent(null);
      return;
    }
    const meta = events.find((e) => e.id === detailId) ?? null;
    if (!meta) {
      setDetailId(null);
      return;
    }
    let cancelled = false;
    void getDetectionEventById(detailId).then((full) => {
      if (!cancelled) setDetailEvent(full ?? meta);
    });
    return () => {
      cancelled = true;
    };
  }, [detailId, events]);

  useEffect(() => {
    if (detailId && !events.some((e) => e.id === detailId)) setDetailId(null);
  }, [detailId, events]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="text-3xl font-bold">Events</div>
          {loading && events.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-1">Loading events…</p>
          ) : null}
          <p className="text-sm text-muted-foreground max-w-3xl mt-1">
            All saved detections with crop images live here. Use the <span className="font-medium text-foreground">table</span>{" "}
            or <span className="font-medium text-foreground">gallery</span> view, then <span className="font-medium text-foreground">click any row or card</span> for full-size image and JSON. Use <span className="font-medium text-foreground">Select folder</span> on each detection tab to save images directly on disk.
          </p>
        </div>
        <div className="flex rounded-lg border border-border bg-card p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => setLayout("table")}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              layout === "table" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <List className="w-4 h-4" /> Table
          </button>
          <button
            type="button"
            onClick={() => setLayout("gallery")}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              layout === "gallery" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutGrid className="w-4 h-4" /> Gallery
          </button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground rounded-lg border border-border bg-card px-4 py-3">
        To save detections to disk, open <span className="font-medium text-foreground">Person</span>,{" "}
        <span className="font-medium text-foreground">Fire &amp; smoke</span>,{" "}
        <span className="font-medium text-foreground">Face recognition</span>, or{" "}
        <span className="font-medium text-foreground">Safety</span> and link an export folder on each tab (each tab uses its own folder).
      </p>

      <div className="flex items-center justify-end">
        <AlertDialog open={confirmClearAllOpen} onOpenChange={setConfirmClearAllOpen}>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              className="px-3 py-2 rounded-lg border border-destructive/40 text-destructive text-sm hover:bg-destructive/10 transition-colors disabled:opacity-40"
              disabled={events.length === 0}
              title="Deletes locally saved events from this browser"
            >
              Clear all events…
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all events?</AlertDialogTitle>
              <AlertDialogDescription>
                This will delete all saved detection events from this browser (IndexedDB).{" "}
                <span className="font-medium">It will not delete any already-exported files on disk</span>.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  void clearAllDetectionEvents();
                  setDetailId(null);
                }}
              >
                Clear all
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-border">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-5 relative">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search by event name, service name and camera name"
                className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-card border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            <div className="lg:col-span-2">
              <select
                value={service}
                onChange={(e) => {
                  setService(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2.5 rounded-lg bg-card border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {serviceOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt === "all" ? "Model / service" : opt}
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-2">
              <select
                value={camera}
                onChange={(e) => {
                  setCamera(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2.5 rounded-lg bg-card border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {cameraOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt === "all" ? "Camera Name" : opt}
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-3 relative">
              <CalendarDays className="w-4 h-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={dateRange}
                onChange={(e) => {
                  setDateRange(e.target.value);
                  setPage(1);
                }}
                placeholder="Filter by date text"
                className="w-full pr-9 pl-3 py-2.5 rounded-lg bg-card border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
        </div>

        {layout === "table" ? (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-foreground text-background">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Event Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Details</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Model</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Camera name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Date &amp; Time</th>
                </tr>
              </thead>
              <tbody>
                {pageSlice.map((r) => (
                  <tr
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setDetailId(r.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDetailId(r.id);
                      }
                    }}
                    className={`border-t border-border cursor-pointer hover:bg-muted/60 transition-colors ${
                      r.severity === "danger" ? "bg-destructive/10" : "bg-card"
                    }`}
                    title="Click for full image and data"
                  >
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3 min-w-[220px]">
                        <div className="w-12 h-12 rounded bg-muted border border-border overflow-hidden shrink-0">
                          {r.thumbUrl ? (
                            <img src={r.thumbUrl} alt="" className="w-full h-full object-cover" />
                          ) : null}
                        </div>
                        <div className="font-medium text-foreground">{r.eventName}</div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-muted-foreground">{r.details}</td>
                    <td className="px-4 py-4 text-muted-foreground">{r.serviceName}</td>
                    <td className="px-4 py-4 text-muted-foreground">{r.cameraName}</td>
                    <td className="px-4 py-4 text-muted-foreground whitespace-nowrap">{r.dateTime}</td>
                  </tr>
                ))}

                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground bg-card">
                      {events.length === 0
                        ? "No saved detections yet. Run live AI processing on a camera to capture snapshots here."
                        : "No events match your filters."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4">
            {filtered.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                {events.length === 0
                  ? "No saved detections yet. Run live AI processing on a camera to capture snapshots here."
                  : "No events match your filters."}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {pageSlice.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setDetailId(r.id)}
                    className="text-left rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 hover:shadow-md transition-all group"
                  >
                    <div className="aspect-square bg-muted relative">
                      {r.thumbUrl ? (
                        <img
                          src={r.thumbUrl}
                          alt=""
                          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                          No image
                        </div>
                      )}
                    </div>
                    <div className="p-3 space-y-1">
                      <div className="font-semibold text-foreground text-sm truncate">{r.eventName}</div>
                      <div className="text-xs text-muted-foreground truncate">{r.cameraName}</div>
                      <div className="text-xs text-muted-foreground">{r.dateTime}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Pagination */}
        <div className="p-3 border-t border-border flex items-center justify-between gap-2 bg-card">
          <div className="text-xs text-muted-foreground">
            {filtered.length} event{filtered.length === 1 ? "" : "s"}
            {filtered.length > 0 ? ` · page ${safePage} / ${totalPages}` : ""}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-8 w-8 rounded border border-border bg-card text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              aria-label="Previous page"
            >
              ‹
            </button>
            <div className="h-8 min-w-8 px-2 rounded border border-warning bg-card text-foreground flex items-center justify-center text-xs font-semibold">
              {safePage}
            </div>
            <button
              type="button"
              className="h-8 w-8 rounded border border-border bg-card text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              aria-label="Next page"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      <Suspense fallback={null}>
        <EventDetailDialog
          open={Boolean(detailId)}
          onOpenChange={(open) => !open && setDetailId(null)}
          event={detailEvent}
          imageUrl={detailEvent ? thumbUrls[detailEvent.id] : undefined}
          onDelete={(id) => void deleteDetectionEvent(id)}
        />
      </Suspense>
    </div>
  );
};

export default EventsView;
