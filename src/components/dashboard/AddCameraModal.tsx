import { useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Usb, Wifi, CircuitBoard, X } from "lucide-react";
import { CAMERA_WORKSPACE_TITLE, type CameraConfig, type CameraWorkspaceId } from "@/pages/Dashboard";
import { getCameraFingerprint, getOrCreateStableCameraId } from "@/services/cameraIdentity";
import { useModels } from "@/hooks/useModels";
import ModelSelector from "@/components/dashboard/ModelSelector";
import { canAddMoreCameras, MAX_CAMERAS, MAX_CAMERAS_MESSAGE } from "@/lib/cameraLimits";

type ModalStep = "type" | "config";
type CameraType = "usb" | "rtsp" | "csi";

export interface AddCameraModalProps {
  open: boolean;
  onClose: () => void;
  workspaceId: CameraWorkspaceId;
  workspaceTitle: string;
  /** Overview: let user pick Person / Fire & Smoke / … before adding. */
  showWorkspacePicker?: boolean;
  onWorkspaceChange?: (id: CameraWorkspaceId) => void;
  /** Total cameras across all workspaces (limit is global). */
  totalCameraCount: number;
  onAddCamera: (camera: CameraConfig, opts?: { openLive?: boolean }) => void;
  onUpdateCamera: (cameraId: string, patch: Partial<CameraConfig>) => void;
}

const cameraTypes = [
  { id: "usb" as CameraType, icon: Usb, title: "USB Camera", desc: "Plug & Play local camera" },
  { id: "rtsp" as CameraType, icon: Wifi, title: "RTSP Camera", desc: "IP Camera over LAN / WAN" },
  { id: "csi" as CameraType, icon: CircuitBoard, title: "CSI Camera", desc: "Direct board-level camera" },
];

export function AddCameraModal({
  open,
  onClose,
  workspaceId,
  workspaceTitle,
  showWorkspacePicker = false,
  onWorkspaceChange,
  totalCameraCount,
  onAddCamera,
  onUpdateCamera,
}: AddCameraModalProps) {
  const atLimit = !canAddMoreCameras(totalCameraCount);
  const [modalStep, setModalStep] = useState<ModalStep>("type");
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

  const closeModal = () => {
    onClose();
  };

  useLayoutEffect(() => {
    if (!open) return;
    setModalStep("type");
    setSelectedType(null);
    setCameraName("");
    setResolution("1920x1080");
    setFps(30);
    setRtspUrl("");
    setSelectedModelId(null);
    setModelPickerOpen(false);
    setAutoStart(true);
    setStartBusy(false);
    setStartErr(null);
  }, [open]);

  const canSubmit = useMemo(() => {
    if (atLimit) return false;
    if (modalStep !== "config") return false;
    if (!selectedType) return false;
    if (!cameraName.trim()) return false;
    if (selectedType === "rtsp" && !rtspUrl.trim()) return false;
    if (autoStart && !selectedModelId) return false;
    if (startBusy) return false;
    return true;
  }, [atLimit, autoStart, cameraName, modalStep, rtspUrl, selectedModelId, selectedType, startBusy]);

  const shouldShowModelPicker = autoStart && (modelPickerOpen || Boolean(selectedModelId));

  const createCamera = () => {
    if (!selectedType) return null;
    const rtsp = selectedType === "rtsp" ? rtspUrl.trim() : undefined;
    const dev = selectedType === "usb" ? "usb:0" : selectedType === "csi" ? "csi:0" : undefined;
    const fp = getCameraFingerprint({ type: selectedType, rtspUrl: rtsp, device: dev });
    const m = selectedModelId ? models.find((x) => x.id === selectedModelId) : undefined;
    const cam: CameraConfig = {
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
      inputType === "rtsp" ? cam.rtspUrl?.trim() : (cam.device ?? (cam.type === "csi" ? "csi:0" : "usb:0"));
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

  const submitAdd = () => {
    if (atLimit) return;
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
  };

  if (!open) return null;

  const limitBanner = atLimit ? (
    <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
      <p className="font-medium">Camera limit reached ({MAX_CAMERAS}/{MAX_CAMERAS})</p>
      <p className="mt-1 text-muted-foreground">{MAX_CAMERAS_MESSAGE}</p>
    </div>
  ) : null;

  const workspaceSelect =
    showWorkspacePicker && onWorkspaceChange ? (
      <div className="mb-4">
        <label className="mb-2 block text-sm font-medium text-secondary-foreground">Detection workspace</label>
        <select
          value={workspaceId}
          onChange={(e) => onWorkspaceChange(e.target.value as CameraWorkspaceId)}
          className="w-full rounded-lg border border-border bg-muted px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          {(Object.keys(CAMERA_WORKSPACE_TITLE) as CameraWorkspaceId[]).map((id) => (
            <option key={id} value={id}>
              {CAMERA_WORKSPACE_TITLE[id]}
            </option>
          ))}
        </select>
      </div>
    ) : null;

  return createPortal(
    <div className="fixed inset-0 z-50 grid animate-fade-in place-items-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="glass relative max-h-[calc(100vh-2rem)] w-full max-w-lg animate-scale-in overflow-hidden rounded-2xl">
        <button
          type="button"
          onClick={closeModal}
          className="absolute right-4 top-4 rounded-lg p-2 transition-colors hover:bg-muted"
        >
          <X className="h-5 w-5 text-muted-foreground" />
        </button>

        <div
          className={`no-scrollbar max-h-[calc(100vh-2rem)] overflow-y-auto p-8 ${
            modalStep === "type" ? "flex min-h-[420px] flex-col justify-center" : ""
          }`}
        >
          {modalStep === "type" && (
            <>
              {limitBanner}
              {workspaceSelect}
              <p className="mb-1 text-sm font-semibold text-primary">{workspaceTitle}</p>
              <h2 className="mb-2 text-2xl font-bold">Add New Camera</h2>
              <p className="mb-6 text-muted-foreground">
                {atLimit ? "Remove a camera before adding another." : "Select camera connection type"}
              </p>
              <div className="space-y-3">
                {cameraTypes.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    disabled={atLimit}
                    onClick={() => {
                      setSelectedType(type.id);
                      setModalStep("config");
                    }}
                    className="group flex w-full items-center gap-4 rounded-xl border border-border bg-muted/50 p-4 text-left transition-all hover:border-primary/50 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 transition-colors group-hover:bg-primary/20">
                      <type.icon className="h-6 w-6 text-primary" />
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
              {limitBanner}
              {workspaceSelect}
              <p className="mb-2 text-sm font-semibold text-primary">{workspaceTitle}</p>
              <h2 className="mb-6 text-2xl font-bold">USB Camera Setup</h2>
              <div className="space-y-4">
                <div className="rounded-xl border border-success/20 bg-success/10 p-4">
                  <p className="text-sm font-medium text-success">✓ Device detected: USB Camera 0</p>
                </div>
                {startErr && (
                  <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                    {startErr}
                  </div>
                )}
                <div>
                  <label className="mb-2 block text-sm font-medium text-secondary-foreground">Camera Name</label>
                  <input
                    value={cameraName}
                    onChange={(e) => setCameraName(e.target.value)}
                    type="text"
                    placeholder="e.g., Lobby Camera"
                    className="w-full rounded-lg border border-border bg-muted px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-secondary-foreground">Resolution</label>
                    <select
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                      className="w-full rounded-lg border border-border bg-muted px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      <option>1920x1080</option>
                      <option>1280x720</option>
                      <option>640x480</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-secondary-foreground">FPS</label>
                    <select
                      value={String(fps)}
                      onChange={(e) => setFps(parseInt(e.target.value, 10))}
                      className="w-full rounded-lg border border-border bg-muted px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
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
                      className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      Select AI Model
                    </button>
                  )
                ) : null}
                <button
                  type="button"
                  onClick={submitAdd}
                  disabled={!canSubmit}
                  className={`w-full rounded-lg py-3 font-semibold glow-primary-sm transition-all ${
                    canSubmit
                      ? "bg-gradient-atomic text-primary-foreground hover:scale-[1.01]"
                      : "cursor-not-allowed bg-muted text-muted-foreground"
                  }`}
                >
                  {autoStart ? (startBusy ? "Starting AI Processing…" : "Add Camera & Start AI") : "Add Camera"}
                </button>
              </div>
            </>
          )}

          {modalStep === "config" && selectedType === "rtsp" && (
            <>
              {limitBanner}
              {workspaceSelect}
              <p className="mb-2 text-sm font-semibold text-primary">{workspaceTitle}</p>
              <h2 className="mb-6 text-2xl font-bold">RTSP Camera Setup</h2>
              <div className="space-y-4">
                {startErr && (
                  <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                    {startErr}
                  </div>
                )}
                <div>
                  <label className="mb-2 block text-sm font-medium text-secondary-foreground">Camera Name</label>
                  <input
                    value={cameraName}
                    onChange={(e) => setCameraName(e.target.value)}
                    type="text"
                    placeholder="e.g., Parking Camera"
                    className="w-full rounded-lg border border-border bg-muted px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-secondary-foreground">RTSP URL</label>
                  <input
                    value={rtspUrl}
                    onChange={(e) => setRtspUrl(e.target.value)}
                    type="text"
                    placeholder="rtsp://192.168.1.100:554/stream"
                    className="w-full rounded-lg border border-border bg-muted px-4 py-3 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-secondary-foreground">Resolution</label>
                    <select
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                      className="w-full rounded-lg border border-border bg-muted px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      <option>1920x1080</option>
                      <option>1280x720</option>
                      <option>640x480</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-secondary-foreground">FPS</label>
                    <select
                      value={String(fps)}
                      onChange={(e) => setFps(parseInt(e.target.value, 10))}
                      className="w-full rounded-lg border border-border bg-muted px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      <option value="30">30</option>
                      <option value="25">25</option>
                      <option value="15">15</option>
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  className="w-full rounded-lg border border-border py-3 text-sm font-medium text-secondary-foreground transition-colors hover:bg-muted"
                >
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
                      className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      Select AI Model
                    </button>
                  )
                ) : null}
                <button
                  type="button"
                  onClick={submitAdd}
                  disabled={!canSubmit}
                  className={`w-full rounded-lg py-3 font-semibold glow-primary-sm transition-all ${
                    canSubmit
                      ? "bg-gradient-atomic text-primary-foreground hover:scale-[1.01]"
                      : "cursor-not-allowed bg-muted text-muted-foreground"
                  }`}
                >
                  {autoStart ? (startBusy ? "Starting AI Processing…" : "Add Camera & Start AI") : "Add Camera"}
                </button>
              </div>
            </>
          )}

          {modalStep === "config" && selectedType === "csi" && (
            <>
              {limitBanner}
              {workspaceSelect}
              <p className="mb-2 text-sm font-semibold text-primary">{workspaceTitle}</p>
              <h2 className="mb-6 text-2xl font-bold">CSI Camera Setup</h2>
              <div className="space-y-4">
                <div className="rounded-xl border border-primary/20 bg-primary/10 p-4">
                  <p className="text-sm font-medium text-primary">🔍 Scanning CSI bus...</p>
                </div>
                {startErr && (
                  <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                    {startErr}
                  </div>
                )}
                <div>
                  <label className="mb-2 block text-sm font-medium text-secondary-foreground">Camera Name</label>
                  <input
                    value={cameraName}
                    onChange={(e) => setCameraName(e.target.value)}
                    type="text"
                    placeholder="e.g., Board Camera"
                    className="w-full rounded-lg border border-border bg-muted px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-secondary-foreground">Resolution</label>
                    <select
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                      className="w-full rounded-lg border border-border bg-muted px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      <option>1920x1080</option>
                      <option>1280x720</option>
                      <option>640x480</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-secondary-foreground">FPS</label>
                    <select
                      value={String(fps)}
                      onChange={(e) => setFps(parseInt(e.target.value, 10))}
                      className="w-full rounded-lg border border-border bg-muted px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
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
                      className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      Select AI Model
                    </button>
                  )
                ) : null}
                <button
                  type="button"
                  onClick={submitAdd}
                  disabled={!canSubmit}
                  className={`w-full rounded-lg py-3 font-semibold glow-primary-sm transition-all ${
                    canSubmit
                      ? "bg-gradient-atomic text-primary-foreground hover:scale-[1.01]"
                      : "cursor-not-allowed bg-muted text-muted-foreground"
                  }`}
                >
                  {autoStart ? (startBusy ? "Starting AI Processing…" : "Add Camera & Start AI") : "Add Camera"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
