import { useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Usb, Wifi, CircuitBoard, X } from "lucide-react";
import { CAMERA_WORKSPACE_TITLE, type CameraConfig, type CameraWorkspaceId } from "@/pages/Dashboard";
import { getCameraFingerprint, getOrCreateStableCameraId } from "@/services/cameraIdentity";
import ModelSelector from "@/components/dashboard/ModelSelector";
import { useWorkspaceModels } from "@/hooks/useWorkspaceModels";
import { inferenceBackendForWorkspace } from "@/lib/inferenceBackend";
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
}: AddCameraModalProps) {
  const atLimit = !canAddMoreCameras(totalCameraCount);
  const [modalStep, setModalStep] = useState<ModalStep>("type");
  const [selectedType, setSelectedType] = useState<CameraType | null>(null);
  const [cameraName, setCameraName] = useState("");
  const [resolution, setResolution] = useState("1920x1080");
  const [fps, setFps] = useState(30);
  const [rtspUrl, setRtspUrl] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const inferenceBackend = inferenceBackendForWorkspace(workspaceId);
  const { models, loading: modelsLoading, error: modelsError } = useWorkspaceModels(workspaceId);

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
  }, [open]);

  const canSubmit = useMemo(() => {
    if (atLimit) return false;
    if (modalStep !== "config") return false;
    if (!selectedType) return false;
    if (!cameraName.trim()) return false;
    if (selectedType === "rtsp" && !rtspUrl.trim()) return false;
    return true;
  }, [atLimit, cameraName, modalStep, rtspUrl, selectedType]);

  const createCamera = () => {
    if (!selectedType) return null;
    const rtsp = selectedType === "rtsp" ? rtspUrl.trim() : undefined;
    const dev = selectedType === "usb" ? "usb:0" : selectedType === "csi" ? "csi:0" : undefined;
    const fp = getCameraFingerprint({ type: selectedType, rtspUrl: rtsp, device: dev });
    const picked = selectedModelId ? models.find((m) => m.id === selectedModelId) : null;
    const cam: CameraConfig = {
      id: fp ? getOrCreateStableCameraId(`${workspaceId}::${fp}`) : String(Date.now()),
      name: cameraName.trim(),
      type: selectedType,
      status: "online",
      resolution,
      fps,
      detectionWorkspace: workspaceId,
      inferenceBackend,
      rtspUrl: rtsp,
      device: dev,
      cpuUsage: 0,
      npuUsage: 0,
      ...(picked
        ? { inferenceModelId: picked.id, model: picked.name }
        : {}),
    };
    return cam;
  };

  const submitAdd = () => {
    if (!canSubmit) return;
    if (atLimit) return;
    const cam = createCamera();
    if (!cam) return;
    onAddCamera(cam, { openLive: true });
    closeModal();
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

  const modelPickerSection = (
    <div className="space-y-2">
      {modelsLoading ? (
        <p className="text-xs text-muted-foreground">Loading models from asnn-dashboard/models…</p>
      ) : null}
      {modelsError ? (
        <p className="text-xs text-destructive">Could not load models: {modelsError}</p>
      ) : null}
      {!modelsLoading && !modelsError && models.length === 0 ? (
        <p className="text-xs text-destructive">
          No models found. Add a folder with .nb and .so under asnn-dashboard/models.
        </p>
      ) : null}
      {models.length > 0 ? (
        <ModelSelector compact selected={selectedModelId} onSelect={setSelectedModelId} models={models} />
      ) : null}
      {!selectedModelId && models.length > 0 ? (
        <p className="text-xs text-muted-foreground">Optional: pick a model now, or choose one in Live View after adding.</p>
      ) : null}
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 grid animate-fade-in place-items-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="glass relative max-h-[calc(100vh-2rem)] w-full max-w-2xl animate-scale-in overflow-hidden rounded-2xl">
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
                {modelPickerSection}
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
                  Add Camera
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
                  disabled={!rtspUrl.trim()}
                  className="w-full rounded-lg border border-border py-3 text-sm font-medium text-secondary-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Test Stream Connection
                </button>
                {modelPickerSection}
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
                  Add Camera
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
                {modelPickerSection}
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
                  Add Camera
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
