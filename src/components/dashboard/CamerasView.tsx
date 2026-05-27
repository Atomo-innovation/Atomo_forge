import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Play, Trash2, LayoutGrid, List, PencilLine, Search } from "lucide-react";
import { type CameraConfig, type CameraWorkspaceId } from "@/pages/Dashboard";
import { useAuthUsername } from "@/contexts/AuthUsernameContext";
import { useWorkspaceDetectionSearch } from "@/hooks/useWorkspaceDetectionSearch";
import { loadDetectionEventThumbUrls, revokeThumbUrls } from "@/services/detectionEventThumbs";
import { detectionEventImageUrl, eventsDatabaseForWorkspace } from "@/services/detectionEventsDb";
import type { StoredDetectionEvent } from "@/services/detectionEventsStore";
import { getDetectionEventById } from "@/services/detectionEventsStore";

const EventDetailDialog = lazy(() => import("@/components/dashboard/EventDetailDialog"));
import {
  classificationBadgeLabel,
  countFaceListFilter,
  faceDetectionDisplayLabel,
  faceIdentityBadgeClass,
  filterEventsByFaceListFilter,
  FACE_LIST_FILTER_LABEL,
  type FaceListFilter,
} from "@/lib/faceRecognition";
import { AddCameraModal } from "@/components/dashboard/AddCameraModal";
import { RenameCameraDialog } from "@/components/dashboard/RenameCameraDialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { DASHBOARD_VIEW_META } from "@/lib/dashboardViewMeta";
import { canAddMoreCameras, MAX_CAMERAS } from "@/lib/cameraLimits";
import { cn } from "@/lib/utils";
import { loadDynamicWorkspaces } from "@/lib/dynamicWorkspaces";
import { removeModelCompletely } from "@/services/modelRemoval";
import { toast } from "sonner";

interface Props {
  /** Which sidebar detection workspace this screen is for — stored on new cameras. */
  workspaceId: CameraWorkspaceId;
  /** Workspace name from sidebar (Person, Fire & Smoke, etc.) */
  workspaceTitle?: string;
  cameras: CameraConfig[];
  /** All cameras on the account (limit is global, not per workspace). */
  totalCameraCount: number;
  onAddCamera: (camera: CameraConfig, opts?: { openLive?: boolean }) => void;
  onUpdateCamera: (cameraId: string, patch: Partial<CameraConfig>) => void;
  onDeleteCamera: (cameraId: string) => void;
  onOpenLiveView: (camera: CameraConfig) => void;
  onNavigate?: (view: CameraWorkspaceId | "models" | "home") => void;
  onModelRemoved?: (removedWorkspaceIds: string[]) => void;
}

const CamerasView = ({
  workspaceId,
  workspaceTitle = "Cameras",
  cameras,
  totalCameraCount,
  onAddCamera,
  onUpdateCamera,
  onDeleteCamera,
  onOpenLiveView,
  onNavigate,
  onModelRemoved,
}: Props) => {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<CameraConfig | null>(null);
  const forgeAccount = useAuthUsername();
  const cameraIds = useMemo(() => cameras.map((c) => c.id), [cameras]);
  const {
    searchQuery,
    setSearchQuery,
    recentEvents,
    loading: detectionsLoading,
    isSearchActive,
    dbAvailable,
    useServerImages,
  } = useWorkspaceDetectionSearch(workspaceId, cameraIds);
  const [detailEvent, setDetailEvent] = useState<StoredDetectionEvent | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [recentThumbUrls, setRecentThumbUrls] = useState<Record<string, string>>({});
  const recentThumbUrlsRef = useRef<Record<string, string>>({});
  const [detectionLayout, setDetectionLayout] = useState<"table" | "gallery">("table");
  const [detectionPage, setDetectionPage] = useState(1);
  const [faceListFilter, setFaceListFilter] = useState<FaceListFilter>("all");

  const isFaceWorkspace = workspaceId === "cameras3";

  const filteredDetectionEvents = useMemo(() => {
    if (!isFaceWorkspace) return recentEvents;
    return filterEventsByFaceListFilter(recentEvents, faceListFilter);
  }, [isFaceWorkspace, recentEvents, faceListFilter]);

  const faceFilterCounts = useMemo(() => {
    if (!isFaceWorkspace) return null;
    return countFaceListFilter(recentEvents);
  }, [isFaceWorkspace, recentEvents]);

  const detectionByCameraId = useMemo(() => {
    const visible = new Set(cameras.map((c) => c.id));
    const m = new Map<string, { count: number; lastAt?: number }>();
    for (const e of recentEvents) {
      if (!visible.has(e.cameraId)) continue;
      const cur = m.get(e.cameraId) ?? { count: 0, lastAt: undefined };
      cur.count += 1;
      cur.lastAt = Math.max(cur.lastAt ?? 0, e.createdAt);
      m.set(e.cameraId, cur);
    }
    return m;
  }, [cameras, recentEvents]);

  const formatTime = (ts?: number) => {
    if (!ts) return "—";
    try {
      return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return String(ts);
    }
  };

  const formatDateTime = (ts?: number) => {
    if (!ts) return "—";
    try {
      return new Date(ts).toLocaleString(undefined, {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return String(ts);
    }
  };

  const DETECTION_PAGE_SIZE = 8;

  useEffect(() => {
    setDetectionPage(1);
  }, [searchQuery, faceListFilter]);

  const detectionTotalPages = Math.max(
    1,
    Math.ceil(filteredDetectionEvents.length / DETECTION_PAGE_SIZE),
  );
  const detectionPageSlice = useMemo(() => {
    const p = Math.min(detectionPage, detectionTotalPages);
    const start = (p - 1) * DETECTION_PAGE_SIZE;
    return filteredDetectionEvents.slice(start, start + DETECTION_PAGE_SIZE);
  }, [filteredDetectionEvents, detectionPage, detectionTotalPages]);

  const detectionSafePage = Math.min(detectionPage, detectionTotalPages);

  const detectionThumbIds = useMemo(() => detectionPageSlice.map((e) => e.id), [detectionPageSlice]);

  useEffect(() => {
    let cancelled = false;
    void loadDetectionEventThumbUrls(detectionThumbIds, {
      forgeAccount,
      workspaceId,
      preferServer: useServerImages,
    }).then((loaded) => {
      if (cancelled) {
        revokeThumbUrls(loaded);
        return;
      }
      const prev = recentThumbUrlsRef.current;
      const next: Record<string, string> = {};
      for (const id of detectionThumbIds) {
        const url = loaded[id] ?? prev[id];
        if (url) next[id] = url;
      }
      for (const [id, url] of Object.entries(prev)) {
        if (!detectionThumbIds.includes(id)) URL.revokeObjectURL(url);
      }
      recentThumbUrlsRef.current = next;
      setRecentThumbUrls(next);
    });
    return () => {
      cancelled = true;
    };
  }, [detectionThumbIds, forgeAccount, workspaceId, useServerImages]);

  const openEventDetail = (e: StoredDetectionEvent) => {
    setDetailEvent(e);
    setDetailOpen(true);
    void getDetectionEventById(e.id).then((full) => {
      if (full) setDetailEvent(full);
    });
  };

  const detailImageUrl =
    detailEvent && forgeAccount
      ? recentThumbUrls[detailEvent.id] ??
        detectionEventImageUrl(detailEvent.id, forgeAccount, workspaceId)
      : detailEvent
        ? recentThumbUrls[detailEvent.id]
        : undefined;

  useEffect(() => {
    return () => {
      revokeThumbUrls(recentThumbUrlsRef.current);
      recentThumbUrlsRef.current = {};
    };
  }, []);

  const meta = DASHBOARD_VIEW_META[workspaceId];
  const canAddCamera = canAddMoreCameras(totalCameraCount);
  const dynamicModelName = useMemo(() => loadDynamicWorkspaces()[workspaceId], [workspaceId]);
  const isDynamicWorkspace = Boolean(dynamicModelName);
  const [removingModel, setRemovingModel] = useState(false);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={meta?.title ?? workspaceTitle}
        description={meta?.description ?? "Manage connected cameras for this workspace."}
        actions={
          <>
            {isDynamicWorkspace ? (
              <button
                type="button"
                onClick={async () => {
                  const ok = window.confirm(
                    `Delete model "${dynamicModelName}" and remove this tab? This cannot be undone.`,
                  );
                  if (!ok) return;
                  setRemovingModel(true);
                  try {
                    const r = await removeModelCompletely(dynamicModelName, forgeAccount);
                    if (!r.ok) {
                      toast.error(r.error || "Could not delete model");
                      return;
                    }
                    onModelRemoved?.(r.removedWorkspaceIds);
                    toast.success(`Deleted "${dynamicModelName}"`);
                    onNavigate?.("models");
                  } finally {
                    setRemovingModel(false);
                  }
                }}
                disabled={removingModel}
                title={removingModel ? "Deleting…" : `Delete "${dynamicModelName}" model & tab`}
                className={cn(
                  "rounded-lg bg-destructive/10 px-3 py-2 text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50",
                )}
              >
                <Trash2 className={cn("h-4 w-4", removingModel && "animate-pulse")} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => canAddCamera && setAddModalOpen(true)}
              disabled={!canAddCamera}
              title={canAddCamera ? undefined : `Maximum ${MAX_CAMERAS} cameras`}
              className={cn(
                "gap-2",
                canAddCamera ? "btn-primary-gradient" : "btn-primary-gradient cursor-not-allowed opacity-50",
              )}
            >
              <Plus className="h-4 w-4" /> Add camera
            </button>
          </>
        }
      />
      <div className="space-y-6">

      {/* Camera list */}
      {cameras.length === 0 ? (
        <div className="bg-surface rounded-2xl p-10 border border-border">
          <div className="max-w-md mx-auto text-center">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">📷</span>
            </div>
            <div className="text-lg font-semibold">No cameras added yet</div>
            <div className="text-sm text-muted-foreground mt-1">
              Use the <span className="font-semibold text-foreground">Add Camera</span> button above to add a USB, RTSP, or CSI camera.
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {cameras.map((cam) => (
            <div
              key={cam.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenLiveView(cam)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpenLiveView(cam);
                }
              }}
              className="bg-surface rounded-xl p-4 flex items-center gap-4 hover:border-primary/30 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <div className="w-32 h-20 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <div className="w-8 h-8 text-muted-foreground/30">📷</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h3 className="font-semibold">{cam.name}</h3>
                  <div className={`w-2 h-2 rounded-full ${cam.status === "online" ? "bg-success" : "bg-muted-foreground"}`} />
                  <span className="text-xs text-muted-foreground uppercase">{cam.status}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {cam.type.toUpperCase()} • {cam.resolution} @ {cam.fps}fps
                  {cam.model && <> • <span className="text-primary">{cam.model}</span></>}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/90">Detections:</span> {detectionByCameraId.get(cam.id)?.count ?? 0}{" "}
                  <span className="text-muted-foreground">·</span>{" "}
                  <span className="font-medium text-foreground/90">Last:</span> {formatTime(detectionByCameraId.get(cam.id)?.lastAt)}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-mono text-primary">NPU {cam.npuUsage}%</p>
                <p className="text-xs font-mono text-muted-foreground">CPU {cam.cpuUsage}%</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenLiveView(cam);
                  }}
                  className="px-3 py-2 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
                  aria-label={`Open live view for ${cam.name}`}
                >
                  <Play className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setRenameTarget(cam); }}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={`Rename ${cam.name}`}
                >
                  <PencilLine className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const ok = window.confirm(`Delete camera "${cam.name}"?`);
                    if (!ok) return;
                    onDeleteCamera(cam.id);
                  }}
                  className="px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm font-medium hover:bg-destructive/20 transition-colors"
                  aria-label={`Delete ${cam.name}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent detections — full Events-style view */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        {/* Header */}
        <div className="flex flex-col gap-3 p-5 border-b border-border">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Recent detections</h2>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 shrink-0 relative z-10">
            <div className="flex rounded-lg border border-border bg-muted/30 p-0.5">
              <button
                type="button"
                onClick={() => setDetectionLayout("table")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  detectionLayout === "table" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <List className="w-3.5 h-3.5" /> Table
              </button>
              <button
                type="button"
                onClick={() => setDetectionLayout("gallery")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  detectionLayout === "gallery" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" /> Gallery
              </button>
            </div>
          </div>
          </div>
          {isFaceWorkspace && faceFilterCounts ? (
            <div
              className="flex flex-wrap gap-2"
              role="tablist"
              aria-label="Filter by identity"
            >
              {(["all", "known", "unknown"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={faceListFilter === key}
                  onClick={() => setFaceListFilter(key)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors",
                    faceListFilter === key
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  {FACE_LIST_FILTER_LABEL[key]}
                  <span
                    className={cn(
                      "min-w-[1.25rem] px-1.5 py-0.5 rounded-full text-[10px] font-semibold tabular-nums",
                      faceListFilter === key ? "bg-primary-foreground/20" : "bg-muted",
                    )}
                  >
                    {faceFilterCounts[key]}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="relative w-full max-w-xl">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search time, event, camera, model…"
              className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              aria-label={`Search ${workspaceTitle} detections`}
            />
            {detectionsLoading && isSearchActive ? (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Searching…</span>
            ) : null}
          </div>
        </div>

        {/* Table View */}
        {detectionLayout === "table" ? (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-foreground text-background">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Event Name</th>
                  {isFaceWorkspace ? (
                    <th className="text-left px-4 py-3 text-xs font-semibold">Identity</th>
                  ) : null}
                  <th className="text-left px-4 py-3 text-xs font-semibold">Details</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Camera</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Date &amp; Time</th>
                </tr>
              </thead>
              <tbody>
                {detectionPageSlice.map((e) => (
                  <tr
                    key={e.id}
                    className="border-t border-border bg-card hover:bg-muted/60 transition-colors cursor-pointer"
                    onClick={() => openEventDetail(e)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 min-w-[180px]">
                        <div className="w-10 h-10 rounded bg-muted border border-border overflow-hidden shrink-0">
                          {recentThumbUrls[e.id] ? (
                            <img src={recentThumbUrls[e.id]} alt={e.label} className="w-full h-full object-cover" />
                          ) : null}
                        </div>
                        <span className="font-medium text-foreground text-sm">{e.label}</span>
                      </div>
                    </td>
                    {isFaceWorkspace ? (
                      <td className="px-4 py-3 text-xs">
                        {e.face ? (
                          <span
                            className={cn(
                              "inline-flex text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border",
                              faceIdentityBadgeClass(e.face.classification),
                            )}
                          >
                            {classificationBadgeLabel(e.face)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    ) : null}
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {typeof e.score === "number" ? `Score ${(e.score * 100).toFixed(1)}%` : "—"}
                      {isFaceWorkspace && typeof e.face?.matchScore === "number"
                        ? ` · match ${(e.face.matchScore * 100).toFixed(0)}%`
                        : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{e.cameraName ?? e.cameraId}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(e.createdAt)}</td>
                  </tr>
                ))}
                {filteredDetectionEvents.length === 0 && (
                  <tr>
                    <td colSpan={isFaceWorkspace ? 5 : 4} className="px-4 py-10 text-center text-sm text-muted-foreground bg-card">
                      {isSearchActive
                        ? "No detections match your search. Try another time, camera name, or event label."
                        : isFaceWorkspace && faceListFilter !== "all"
                          ? `No ${FACE_LIST_FILTER_LABEL[faceListFilter].toLowerCase()} detections in this list.`
                          : "No detections yet. Start inference on a camera to see detections here."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* Gallery View */
          <div className="p-4">
            {filteredDetectionEvents.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {isSearchActive
                  ? "No detections match your search."
                  : isFaceWorkspace && faceListFilter !== "all"
                    ? `No ${FACE_LIST_FILTER_LABEL[faceListFilter].toLowerCase()} detections.`
                    : "No detections yet. Start inference on a camera to see detections here."}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {detectionPageSlice.map((e) => (
                  <div
                    key={e.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openEventDetail(e)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") openEventDetail(e);
                    }}
                    className="rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 hover:shadow-md transition-all cursor-pointer"
                  >
                    <div className="aspect-square bg-muted">
                      {recentThumbUrls[e.id] ? (
                        <img src={recentThumbUrls[e.id]} alt={e.label} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">No image</div>
                      )}
                    </div>
                    <div className="p-3 space-y-1">
                      <div className="font-semibold text-foreground text-sm truncate">
                        {e.label}
                      </div>
                      {isFaceWorkspace && e.face ? (
                        <span
                          className={cn(
                            "inline-block text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border mt-1",
                            faceIdentityBadgeClass(e.face.classification),
                          )}
                        >
                          {classificationBadgeLabel(e.face)}
                        </span>
                      ) : null}
                      <div className="text-xs text-muted-foreground truncate">{e.cameraName ?? e.cameraId}</div>
                      <div className="text-xs text-muted-foreground">{formatDateTime(e.createdAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Pagination */}
        {filteredDetectionEvents.length > 0 && (
          <div className="p-3 border-t border-border flex items-center justify-between gap-2 bg-card">
            <div className="text-xs text-muted-foreground">
              {filteredDetectionEvents.length} event{filteredDetectionEvents.length === 1 ? "" : "s"}
              {isFaceWorkspace && faceListFilter !== "all" ? ` (${FACE_LIST_FILTER_LABEL[faceListFilter]})` : ""}
              {filteredDetectionEvents.length > 0 ? ` · page ${detectionSafePage} / ${detectionTotalPages}` : ""}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="h-7 w-7 rounded border border-border bg-card text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40 text-sm"
                onClick={() => setDetectionPage((p) => Math.max(1, p - 1))}
                disabled={detectionSafePage <= 1}
              >
                ‹
              </button>
              <div className="h-7 min-w-7 px-2 rounded border border-warning bg-card text-foreground flex items-center justify-center text-xs font-semibold">
                {detectionSafePage}
              </div>
              <button
                type="button"
                className="h-7 w-7 rounded border border-border bg-card text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40 text-sm"
                onClick={() => setDetectionPage((p) => Math.min(detectionTotalPages, p + 1))}
                disabled={detectionSafePage >= detectionTotalPages}
              >
                ›
              </button>
            </div>
          </div>
        )}
      </section>
      </div>

      <AddCameraModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        workspaceId={workspaceId}
        workspaceTitle={workspaceTitle}
        totalCameraCount={totalCameraCount}
        onAddCamera={onAddCamera}
      />
      <Suspense fallback={null}>
        <EventDetailDialog
          open={detailOpen}
          onOpenChange={setDetailOpen}
          event={detailEvent}
          imageUrl={detailImageUrl}
          onDelete={() => {
            setDetailOpen(false);
            setDetailEvent(null);
          }}
        />
      </Suspense>

      <RenameCameraDialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        camera={renameTarget}
        onSave={(id, name) => onUpdateCamera(id, { name })}
      />
    </div>
  );
};

export default CamerasView;
