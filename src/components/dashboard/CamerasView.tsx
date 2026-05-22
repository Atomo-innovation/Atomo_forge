import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Play, Trash2, LayoutGrid, List, PencilLine } from "lucide-react";
import { type CameraConfig, type CameraWorkspaceId } from "@/pages/Dashboard";
import type { StoredDetectionEvent } from "@/services/detectionEventsStore";
import { useDetectionEvents } from "@/hooks/useDetectionEvents";
import { loadDetectionEventThumbUrls, revokeThumbUrls } from "@/services/detectionEventThumbs";
import {
  EXPORT_FOLDER_LINK_CHANGED,
  clearExportRootDirectoryHandle,
  isFolderDiskExportSupported,
  loadExportRootDirectoryHandle,
  pickAndLinkExportFolder,
} from "@/services/detectionFolderExport";
import { AddCameraModal } from "@/components/dashboard/AddCameraModal";
import { RenameCameraDialog } from "@/components/dashboard/RenameCameraDialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { DASHBOARD_VIEW_META } from "@/lib/dashboardViewMeta";
import { canAddMoreCameras, MAX_CAMERAS } from "@/lib/cameraLimits";
import { cn } from "@/lib/utils";

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
}: Props) => {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<CameraConfig | null>(null);
  const { events } = useDetectionEvents(1000);
  const [recentThumbUrls, setRecentThumbUrls] = useState<Record<string, string>>({});
  const recentThumbUrlsRef = useRef<Record<string, string>>({});
  const [detectionLayout, setDetectionLayout] = useState<"table" | "gallery">("table");
  const [folderLinked, setFolderLinked] = useState(false);
  const [folderMsg, setFolderMsg] = useState<string | null>(null);
  const [detectionPage, setDetectionPage] = useState(1);
  const fsSupported = isFolderDiskExportSupported();

  const refreshFolderLink = () => {
    void loadExportRootDirectoryHandle().then((h) => setFolderLinked(Boolean(h)));
  };

  useEffect(() => {
    refreshFolderLink();
    const onLink = () => refreshFolderLink();
    window.addEventListener(EXPORT_FOLDER_LINK_CHANGED, onLink as EventListener);
    return () => window.removeEventListener(EXPORT_FOLDER_LINK_CHANGED, onLink as EventListener);
  }, []);

  const detectionByCameraId = useMemo(() => {
    const visible = new Set(cameras.map((c) => c.id));
    const m = new Map<string, { count: number; lastAt?: number }>();
    for (const e of events) {
      if (!visible.has(e.cameraId)) continue;
      const cur = m.get(e.cameraId) ?? { count: 0, lastAt: undefined };
      cur.count += 1;
      cur.lastAt = Math.max(cur.lastAt ?? 0, e.createdAt);
      m.set(e.cameraId, cur);
    }
    return m;
  }, [cameras, events]);

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

  const recentEvents = useMemo(() => {
    if (!cameras.length) return [] as StoredDetectionEvent[];
    const visible = new Set(cameras.map((c) => c.id));
    return events
      .filter((e) => visible.has(e.cameraId))
      .sort((a, b) => b.createdAt - a.createdAt)
      ;
  }, [cameras, events]);

  const DETECTION_PAGE_SIZE = 8;
  const detectionTotalPages = Math.max(1, Math.ceil(recentEvents.length / DETECTION_PAGE_SIZE));
  const detectionPageSlice = useMemo(() => {
    const p = Math.min(detectionPage, detectionTotalPages);
    const start = (p - 1) * DETECTION_PAGE_SIZE;
    return recentEvents.slice(start, start + DETECTION_PAGE_SIZE);
  }, [recentEvents, detectionPage, detectionTotalPages]);

  const detectionSafePage = Math.min(detectionPage, detectionTotalPages);

  const detectionThumbIds = useMemo(() => detectionPageSlice.map((e) => e.id), [detectionPageSlice]);

  useEffect(() => {
    let cancelled = false;
    void loadDetectionEventThumbUrls(detectionThumbIds).then((loaded) => {
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
  }, [detectionThumbIds]);

  useEffect(() => {
    return () => {
      revokeThumbUrls(recentThumbUrlsRef.current);
      recentThumbUrlsRef.current = {};
    };
  }, []);

  const meta = DASHBOARD_VIEW_META[workspaceId];
  const canAddCamera = canAddMoreCameras(totalCameraCount);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={meta?.title ?? workspaceTitle}
        description={meta?.description ?? "Manage connected cameras for this workspace."}
        actions={
          <button
            type="button"
            onClick={() => canAddCamera && setAddModalOpen(true)}
            disabled={!canAddCamera}
            title={canAddCamera ? undefined : `Maximum ${MAX_CAMERAS} cameras`}
            className={cn("gap-2", canAddCamera ? "btn-primary-gradient" : "btn-primary-gradient cursor-not-allowed opacity-50")}
          >
            <Plus className="h-4 w-4" /> Add camera
          </button>
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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-5 border-b border-border">
          <h2 className="text-lg font-semibold tracking-tight">Recent detections</h2>
          <div className="flex items-center gap-2 shrink-0">
            {/* Export folder button */}
            {fsSupported && (
              folderLinked ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-success">Folder linked</span>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted transition-colors"
                    onClick={() => {
                      setFolderMsg(null);
                      void pickAndLinkExportFolder().then((r) => {
                        if (!r.ok && r.error) setFolderMsg(r.error);
                      });
                    }}
                  >
                    Change…
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg border border-destructive/40 text-destructive text-xs hover:bg-destructive/10 transition-colors"
                    onClick={() => { setFolderMsg(null); void clearExportRootDirectoryHandle(); }}
                  >
                    Unlink
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg bg-gradient-atomic text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
                  onClick={() => {
                    setFolderMsg(null);
                    void pickAndLinkExportFolder().then((r) => {
                      if (!r.ok && !r.aborted && r.error) setFolderMsg(r.error);
                    });
                  }}
                >
                  Choose export folder…
                </button>
              )
            )}
            {/* Table / Gallery toggle */}
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

        {folderMsg && (
          <div className="mx-5 mt-3 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
            {folderMsg}
          </div>
        )}

        {/* Table View */}
        {detectionLayout === "table" ? (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-foreground text-background">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Event Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Details</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Camera</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Date &amp; Time</th>
                </tr>
              </thead>
              <tbody>
                {detectionPageSlice.map((e) => (
                  <tr key={e.id} className="border-t border-border bg-card hover:bg-muted/60 transition-colors">
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
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {typeof e.score === "number" ? `Score ${(e.score * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{e.cameraName ?? e.cameraId}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(e.createdAt)}</td>
                  </tr>
                ))}
                {recentEvents.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground bg-card">
                      No detections yet. Start inference on a camera to see detections here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* Gallery View */
          <div className="p-4">
            {recentEvents.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No detections yet. Start inference on a camera to see detections here.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {detectionPageSlice.map((e) => (
                  <div
                    key={e.id}
                    className="rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 hover:shadow-md transition-all"
                  >
                    <div className="aspect-square bg-muted">
                      {recentThumbUrls[e.id] ? (
                        <img src={recentThumbUrls[e.id]} alt={e.label} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">No image</div>
                      )}
                    </div>
                    <div className="p-3 space-y-1">
                      <div className="font-semibold text-foreground text-sm truncate">{e.label}</div>
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
        {recentEvents.length > 0 && (
          <div className="p-3 border-t border-border flex items-center justify-between gap-2 bg-card">
            <div className="text-xs text-muted-foreground">
              {recentEvents.length} event{recentEvents.length === 1 ? "" : "s"}
              {recentEvents.length > 0 ? ` · page ${detectionSafePage} / ${detectionTotalPages}` : ""}
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
        onUpdateCamera={onUpdateCamera}
      />
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
