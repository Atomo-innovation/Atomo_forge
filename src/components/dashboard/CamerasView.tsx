import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Usb, Wifi, CircuitBoard, X, Play, Trash2, LayoutGrid, List } from "lucide-react";
import { type CameraConfig, type CameraWorkspaceId } from "@/pages/Dashboard";
import { getCameraFingerprint, getOrCreateStableCameraId } from "@/services/cameraIdentity";
import { DETECTION_EVENTS_CHANGED_EVENT, listDetectionEvents, type StoredDetectionEvent } from "@/services/detectionEventsStore";
import { useModels } from "@/hooks/useModels";
import ModelSelector from "@/components/dashboard/ModelSelector";
import {
  EXPORT_FOLDER_LINK_CHANGED,
  EXPORT_SUBDIR,
  clearExportRootDirectoryHandle,
  isFolderDiskExportSupported,
  loadExportRootDirectoryHandle,
  pickAndLinkExportFolder,
} from "@/services/detectionFolderExport";

interface Props {
  /** Which sidebar detection workspace this screen is for — stored on new cameras. */
  workspaceId: CameraWorkspaceId;
  /** Workspace name from sidebar (Person, Fire & Smoke, etc.) */
  workspaceTitle?: string;
  cameras: CameraConfig[];
  onAddCamera: (camera: CameraConfig, opts?: { openLive?: boolean }) => void;
  onUpdateCamera: (cameraId: string, patch: Partial<CameraConfig>) => void;
  onDeleteCamera: (cameraId: string) => void;
  onOpenLiveView: (camera: CameraConfig) => void;
}

type ModalStep = "closed" | "type" | "config";
type CameraType = "usb" | "rtsp" | "csi";

const CamerasView = ({
  workspaceId,
  workspaceTitle = "Cameras",
  cameras,
  onAddCamera,
  onUpdateCamera,
  onDeleteCamera,
  onOpenLiveView,
}: Props) => {
  const [modalStep, setModalStep] = useState<ModalStep>("closed");
  const [selectedType, setSelectedType] = useState<CameraType | null>(null);
  const [cameraName, setCameraName] = useState("");
  const [resolution, setResolution] = useState("1920x1080");
  const [fps, setFps] = useState(30);
  const [rtspUrl, setRtspUrl] = useState("");
  const { models } = useModels();
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [autoStart, setAutoStart] = useState(true);
  const [startBusy, setStartBusy] = useState(false);
  const [startErr, setStartErr] = useState<string | null>(null);
  const [events, setEvents] = useState<StoredDetectionEvent[]>([]);
  const [recentThumbUrls, setRecentThumbUrls] = useState<Record<string, string>>({});
  const recentThumbUrlsRef = useRef<Record<string, string>>({});
  const [detectionLayout, setDetectionLayout] = useState<"table" | "gallery">("table");
  const [folderLinked, setFolderLinked] = useState(false);
  const [folderMsg, setFolderMsg] = useState<string | null>(null);
  const [detectionPage, setDetectionPage] = useState(1);
  const fsSupported = isFolderDiskExportSupported();

  const resetForm = () => {
    setCameraName("");
    setResolution("1920x1080");
    setFps(30);
    setRtspUrl("");
    setSelectedModelId(null);
    setModelPickerOpen(false);
    setAutoStart(true);
    setStartBusy(false);
    setStartErr(null);
  };

  const cameraTypes = [
    { id: "usb" as CameraType, icon: Usb, title: "USB Camera", desc: "Plug & Play local camera" },
    { id: "rtsp" as CameraType, icon: Wifi, title: "RTSP Camera", desc: "IP Camera over LAN / WAN" },
    { id: "csi" as CameraType, icon: CircuitBoard, title: "CSI Camera", desc: "Direct board-level camera" },
  ];

  const canSubmit = useMemo(() => {
    if (modalStep !== "config") return false;
    if (!selectedType) return false;
    if (!cameraName.trim()) return false;
    if (selectedType === "rtsp" && !rtspUrl.trim()) return false;
    if (autoStart && !selectedModelId) return false;
    if (startBusy) return false;
    return true;
  }, [autoStart, cameraName, modalStep, rtspUrl, selectedModelId, selectedType, startBusy]);

  const shouldShowModelPicker = autoStart && (modelPickerOpen || Boolean(selectedModelId));

  const createCamera = () => {
    if (!selectedType) return null;
    const rtsp = selectedType === "rtsp" ? rtspUrl.trim() : undefined;
    const dev = selectedType === "usb" ? "usb:0" : selectedType === "csi" ? "csi:0" : undefined;
    const fp = getCameraFingerprint({ type: selectedType, rtspUrl: rtsp, device: dev });
    const m = selectedModelId ? models.find((x) => x.id === selectedModelId) : undefined;
    const cam: CameraConfig = {
      // Same physical camera can be used in multiple detection workspaces; keep IDs separate per workspace.
      id: fp ? getOrCreateStableCameraId(`${workspaceId}::${fp}`) : String(Date.now()),
      name: cameraName.trim(),
      type: selectedType,
      status: "online",
      resolution,
      fps,
      detectionWorkspace: workspaceId,
      rtspUrl: rtsp,
      device: dev,
      cpuUsage: 0,
      npuUsage: 0,
      model: m?.name,
      inferenceModelId: m?.id,
    };
    return cam;
  };

  const startInferenceForCamera = async (cam: CameraConfig) => {
    const inputType = cam.type === "rtsp" ? "rtsp" : "webcam";
    const inputValue =
      inputType === "rtsp"
        ? cam.rtspUrl?.trim()
        : (cam.device ?? (cam.type === "csi" ? "csi:0" : "usb:0"));
    if (!inputValue) throw new Error("Camera input missing (RTSP URL / device)");
    if (!cam.model) throw new Error("Select a model first");

    const res = await fetch("/universal/api/inference/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelName: cam.model,
        inputType,
        inputValue,
        objThresh: 0.25,
        nmsThresh: 0.45,
        logLevel: 0,
        // Lower JPEG quality reduces CPU (encode/decode) and bandwidth.
        jpegQuality: 60,
      }),
    });
    if (!res.ok) throw new Error(`Inference start failed (${res.status})`);
    const data = (await res.json()) as { sessionId?: string; error?: string };
    if (!data.sessionId) throw new Error(data.error || "Inference start missing sessionId");
    onUpdateCamera(cam.id, {
      inferenceSessionId: data.sessionId,
      inferenceModelId: cam.inferenceModelId,
      inferenceStartedAt: Date.now(),
      model: cam.model,
    });
  };

  useEffect(() => {
    const reload = () => void listDetectionEvents().then(setEvents).catch(() => setEvents([]));
    reload();
    const onChanged = () => reload();
    window.addEventListener(DETECTION_EVENTS_CHANGED_EVENT, onChanged as EventListener);
    return () => window.removeEventListener(DETECTION_EVENTS_CHANGED_EVENT, onChanged as EventListener);
  }, []);

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

  useEffect(() => {
    const prev = recentThumbUrlsRef.current;
    const next: Record<string, string> = {};

    for (const e of recentEvents) {
      const existing = prev[e.id];
      next[e.id] = existing ?? URL.createObjectURL(e.cropImage);
    }

    for (const [id, url] of Object.entries(prev)) {
      if (!next[id]) URL.revokeObjectURL(url);
    }

    recentThumbUrlsRef.current = next;
    setRecentThumbUrls(next);
  }, [recentEvents]);

  useEffect(() => {
    return () => {
      const cur = recentThumbUrlsRef.current;
      for (const url of Object.values(cur)) URL.revokeObjectURL(url);
      recentThumbUrlsRef.current = {};
    };
  }, []);

  const closeModal = () => {
    setModalStep("closed");
    setSelectedType(null);
    resetForm();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-1">{workspaceTitle}</h1>
          <p className="text-muted-foreground">Manage connected cameras for this workspace</p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setModalStep("type");
          }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-atomic text-primary-foreground text-sm font-medium glow-primary-sm hover:scale-[1.02] transition-all"
        >
          <Plus className="w-4 h-4" /> Add Camera
        </button>
      </div>

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
            <div key={cam.id} className="bg-surface rounded-xl p-4 flex items-center gap-4 hover:border-primary/30 transition-colors">
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
                  onClick={() => onOpenLiveView(cam)}
                  disabled={cam.status === "offline"}
                  className="px-3 py-2 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors disabled:opacity-40"
                >
                  <Play className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
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

      {/* Add Camera Modal */}
      {modalStep !== "closed" && typeof document !== "undefined" && createPortal((
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm animate-fade-in grid place-items-center p-4">
          <div className="w-full max-w-lg glass rounded-2xl animate-scale-in relative max-h-[calc(100vh-2rem)] overflow-hidden">
            <button onClick={closeModal} className="absolute top-4 right-4 p-2 rounded-lg hover:bg-muted transition-colors">
              <X className="w-5 h-5 text-muted-foreground" />
            </button>

            <div
              className={`p-8 overflow-y-auto no-scrollbar max-h-[calc(100vh-2rem)] ${
                modalStep === "type" ? "flex flex-col justify-center min-h-[420px]" : ""
              }`}
            >

            {modalStep === "type" && (
              <>
                <p className="text-sm font-semibold text-primary mb-1">{workspaceTitle}</p>
                <h2 className="text-2xl font-bold mb-2">Add New Camera</h2>
                <p className="text-muted-foreground mb-6">Select camera connection type</p>
                <div className="space-y-3">
                  {cameraTypes.map((type) => (
                    <button
                      key={type.id}
                      onClick={() => { setSelectedType(type.id); setModalStep("config"); }}
                      className="w-full flex items-center gap-4 p-4 rounded-xl bg-muted/50 border border-border hover:border-primary/50 hover:bg-muted transition-all text-left group"
                    >
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                        <type.icon className="w-6 h-6 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold">{type.title}</h3>
                        <p className="text-sm text-muted-foreground">{type.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {modalStep === "config" && selectedType === "usb" && (
              <>
                <p className="text-sm font-semibold text-primary mb-2">{workspaceTitle}</p>
                <h2 className="text-2xl font-bold mb-6">USB Camera Setup</h2>
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-success/10 border border-success/20">
                    <p className="text-sm text-success font-medium">✓ Device detected: USB Camera 0</p>
                  </div>
                  {startErr && (
                    <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                      {startErr}
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-secondary-foreground mb-2">Camera Name</label>
                    <input
                      value={cameraName}
                      onChange={(e) => setCameraName(e.target.value)}
                      type="text"
                      placeholder="e.g., Lobby Camera"
                      className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-secondary-foreground mb-2">Resolution</label>
                      <select
                        value={resolution}
                        onChange={(e) => setResolution(e.target.value)}
                        className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      >
                        <option>1920x1080</option>
                        <option>1280x720</option>
                        <option>640x480</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-secondary-foreground mb-2">FPS</label>
                      <select
                        value={String(fps)}
                        onChange={(e) => setFps(parseInt(e.target.value, 10))}
                        className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      >
                        <option value="30">30</option>
                        <option value="25">25</option>
                        <option value="15">15</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={autoStart}
                        onChange={(e) => setAutoStart(e.target.checked)}
                      />
                      Auto-start AI processing (recommended)
                    </label>
                    {autoStart ? (
                      <div className="text-xs text-muted-foreground">
                        Select a model now. Events will start recording automatically when detections happen.
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        You can start AI processing later from Live View.
                      </div>
                    )}
                  </div>
                  {autoStart ? (
                    shouldShowModelPicker ? (
                      <ModelSelector selected={selectedModelId} onSelect={setSelectedModelId} models={models} />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setModelPickerOpen(true)}
                        className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                      >
                        Select AI Model
                      </button>
                    )
                  ) : null}
                  <button
                    onClick={() => {
                      const cam = createCamera();
                      if (!cam) return;
                      setStartErr(null);
                      onAddCamera(cam, { openLive: false });
                      if (!autoStart) {
                        closeModal();
                        return;
                      }
                      setStartBusy(true);
                      void startInferenceForCamera(cam)
                        .then(() => closeModal())
                        .catch((e) => {
                          const msg = e instanceof Error ? e.message : "Failed to start processing";
                          setStartErr(msg);
                        })
                        .finally(() => setStartBusy(false));
                    }}
                    disabled={!canSubmit}
                    className={`w-full py-3 rounded-lg font-semibold glow-primary-sm transition-all ${
                      canSubmit
                        ? "bg-gradient-atomic text-primary-foreground hover:scale-[1.01]"
                        : "bg-muted text-muted-foreground cursor-not-allowed"
                    }`}
                  >
                    {autoStart ? (startBusy ? "Starting AI Processing…" : "Add Camera & Start AI") : "Add Camera"}
                  </button>
                </div>
              </>
            )}

            {modalStep === "config" && selectedType === "rtsp" && (
              <>
                <p className="text-sm font-semibold text-primary mb-2">{workspaceTitle}</p>
                <h2 className="text-2xl font-bold mb-6">RTSP Camera Setup</h2>
                <div className="space-y-4">
                  {startErr && (
                    <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                      {startErr}
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-secondary-foreground mb-2">Camera Name</label>
                    <input
                      value={cameraName}
                      onChange={(e) => setCameraName(e.target.value)}
                      type="text"
                      placeholder="e.g., Parking Camera"
                      className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-secondary-foreground mb-2">RTSP URL</label>
                    <input
                      value={rtspUrl}
                      onChange={(e) => setRtspUrl(e.target.value)}
                      type="text"
                      placeholder="rtsp://192.168.1.100:554/stream"
                      className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-secondary-foreground mb-2">Resolution</label>
                      <select
                        value={resolution}
                        onChange={(e) => setResolution(e.target.value)}
                        className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      >
                        <option>1920x1080</option>
                        <option>1280x720</option>
                        <option>640x480</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-secondary-foreground mb-2">FPS</label>
                      <select
                        value={String(fps)}
                        onChange={(e) => setFps(parseInt(e.target.value, 10))}
                        className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      >
                        <option value="30">30</option>
                        <option value="25">25</option>
                        <option value="15">15</option>
                      </select>
                    </div>
                  </div>
                  <button className="w-full py-3 rounded-lg border border-border text-sm font-medium text-secondary-foreground hover:bg-muted transition-colors">
                    Test Stream Connection
                  </button>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
                      Auto-start AI processing (recommended)
                    </label>
                    {autoStart ? (
                      <div className="text-xs text-muted-foreground">
                        Select a model now. Events will start recording automatically when detections happen.
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">You can start AI processing later from Live View.</div>
                    )}
                  </div>
                  {autoStart ? (
                    shouldShowModelPicker ? (
                      <ModelSelector selected={selectedModelId} onSelect={setSelectedModelId} models={models} />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setModelPickerOpen(true)}
                        className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                      >
                        Select AI Model
                      </button>
                    )
                  ) : null}
                  <button
                    onClick={() => {
                      const cam = createCamera();
                      if (!cam) return;
                      setStartErr(null);
                      onAddCamera(cam, { openLive: false });
                      if (!autoStart) {
                        closeModal();
                        return;
                      }
                      setStartBusy(true);
                      void startInferenceForCamera(cam)
                        .then(() => closeModal())
                        .catch((e) => {
                          const msg = e instanceof Error ? e.message : "Failed to start processing";
                          setStartErr(msg);
                        })
                        .finally(() => setStartBusy(false));
                    }}
                    disabled={!canSubmit}
                    className={`w-full py-3 rounded-lg font-semibold glow-primary-sm transition-all ${
                      canSubmit
                        ? "bg-gradient-atomic text-primary-foreground hover:scale-[1.01]"
                        : "bg-muted text-muted-foreground cursor-not-allowed"
                    }`}
                  >
                    {autoStart ? (startBusy ? "Starting AI Processing…" : "Add Camera & Start AI") : "Add Camera"}
                  </button>
                </div>
              </>
            )}

            {modalStep === "config" && selectedType === "csi" && (
              <>
                <p className="text-sm font-semibold text-primary mb-2">{workspaceTitle}</p>
                <h2 className="text-2xl font-bold mb-6">CSI Camera Setup</h2>
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-primary/10 border border-primary/20">
                    <p className="text-sm text-primary font-medium">🔍 Scanning CSI bus...</p>
                  </div>
                  {startErr && (
                    <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                      {startErr}
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-secondary-foreground mb-2">Camera Name</label>
                    <input
                      value={cameraName}
                      onChange={(e) => setCameraName(e.target.value)}
                      type="text"
                      placeholder="e.g., Board Camera"
                      className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-secondary-foreground mb-2">Resolution</label>
                      <select
                        value={resolution}
                        onChange={(e) => setResolution(e.target.value)}
                        className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      >
                        <option>1920x1080</option>
                        <option>1280x720</option>
                        <option>640x480</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-secondary-foreground mb-2">FPS</label>
                      <select
                        value={String(fps)}
                        onChange={(e) => setFps(parseInt(e.target.value, 10))}
                        className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      >
                        <option value="30">30</option>
                        <option value="25">25</option>
                        <option value="15">15</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
                      Auto-start AI processing (recommended)
                    </label>
                    {autoStart ? (
                      <div className="text-xs text-muted-foreground">
                        Select a model now. Events will start recording automatically when detections happen.
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">You can start AI processing later from Live View.</div>
                    )}
                  </div>
                  {autoStart ? (
                    shouldShowModelPicker ? (
                      <ModelSelector selected={selectedModelId} onSelect={setSelectedModelId} models={models} />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setModelPickerOpen(true)}
                        className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                      >
                        Select AI Model
                      </button>
                    )
                  ) : null}
                  <button
                    onClick={() => {
                      const cam = createCamera();
                      if (!cam) return;
                      setStartErr(null);
                      onAddCamera(cam, { openLive: false });
                      if (!autoStart) {
                        closeModal();
                        return;
                      }
                      setStartBusy(true);
                      void startInferenceForCamera(cam)
                        .then(() => closeModal())
                        .catch((e) => {
                          const msg = e instanceof Error ? e.message : "Failed to start processing";
                          setStartErr(msg);
                        })
                        .finally(() => setStartBusy(false));
                    }}
                    disabled={!canSubmit}
                    className={`w-full py-3 rounded-lg font-semibold glow-primary-sm transition-all ${
                      canSubmit
                        ? "bg-gradient-atomic text-primary-foreground hover:scale-[1.01]"
                        : "bg-muted text-muted-foreground cursor-not-allowed"
                    }`}
                  >
                    {autoStart ? (startBusy ? "Starting AI Processing…" : "Add Camera & Start AI") : "Add Camera"}
                  </button>
                </div>
              </>
            )}
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  );
};

export default CamerasView;
