import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardTopBar from "@/components/dashboard/DashboardTopBar";
import InferenceEventsRecorder from "@/components/dashboard/InferenceEventsRecorder";
import { clearAllDetectionEvents } from "@/services/detectionEventsStore";
import { clearExportRootDirectoryHandle } from "@/services/detectionFolderExport";
import { clearCameraRegistry } from "@/services/cameraRegistry";
import { clearCameraIdMap, getCameraFingerprint, getOrCreateStableCameraId } from "@/services/cameraIdentity";

export type DashboardView =
  | "home"
  | "cameras"
  | "cameras2"
  | "cameras3"
  | "cameras4"
  | "liveview"
  | "services"
  | "events"
  | "models"
  | "settings";

const CAMERA_PANEL_VIEWS: readonly DashboardView[] = ["cameras", "cameras2", "cameras3", "cameras4"];

/** Sidebar label for each camera workspace — shown on Cameras / add-camera UI */
export const CAMERA_WORKSPACE_TITLE: Record<"cameras" | "cameras2" | "cameras3" | "cameras4", string> = {
  cameras: "Person",
  cameras2: "Fire & Smoke",
  cameras3: "Face recognition",
  cameras4: "Safety",
};

export type CameraWorkspaceId = keyof typeof CAMERA_WORKSPACE_TITLE;

const CAMERA_WORKSPACE_IDS = new Set<string>(Object.keys(CAMERA_WORKSPACE_TITLE));

export interface CameraConfig {
  id: string;
  name: string;
  type: "usb" | "rtsp" | "csi";
  status: "online" | "offline";
  resolution: string;
  fps: number;
  /** Which detection workspace this camera was added from (Person, Fire & Smoke, …). */
  detectionWorkspace?: CameraWorkspaceId;
  model?: string;
  inferenceSessionId?: string;
  inferenceModelId?: string;
  inferenceStartedAt?: number;
  rtspUrl?: string;
  device?: string; // e.g. "usb:0" | "csi:0"
  cpuUsage: number;
  npuUsage: number;
}

const CAMERAS_STORAGE_KEY = "atomo-forge:cameras:v1";

const DashboardHome = lazy(() => import("@/components/dashboard/DashboardHome"));
const CamerasView = lazy(() => import("@/components/dashboard/CamerasView"));
const LiveViewScreen = lazy(() => import("@/components/dashboard/LiveViewScreen"));
const ModelsView = lazy(() => import("@/components/dashboard/ModelsView"));
const ServicesView = lazy(() => import("@/components/dashboard/ServicesView"));
const EventsView = lazy(() => import("@/components/dashboard/EventsView"));
const SettingsView = lazy(() => import("@/components/dashboard/SettingsView"));

function isCameraType(v: unknown): v is CameraConfig["type"] {
  return v === "usb" || v === "rtsp" || v === "csi";
}

function sanitizeCamera(raw: any): CameraConfig | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  if (!isCameraType(raw.type)) return null;
  if (raw.status !== "online" && raw.status !== "offline") return null;
  if (typeof raw.resolution !== "string") return null;
  if (typeof raw.fps !== "number") return null;
  if (typeof raw.cpuUsage !== "number") return null;
  if (typeof raw.npuUsage !== "number") return null;

  const wsRaw = raw.detectionWorkspace;
  const detectionWorkspace =
    typeof wsRaw === "string" && CAMERA_WORKSPACE_IDS.has(wsRaw)
      ? (wsRaw as CameraWorkspaceId)
      : undefined;

  // Migration: older builds generated the same stable camera ID across workspaces
  // (based only on input fingerprint). That caused delete-in-one-workspace to delete
  // the "same" camera entry in another workspace. We re-key IDs per workspace.
  const fp = getCameraFingerprint({ type: raw.type, rtspUrl: raw.rtspUrl, device: raw.device });
  let id = raw.id as string;
  if (detectionWorkspace && fp) {
    try {
      const legacyId = getOrCreateStableCameraId(fp);
      if (id === legacyId) {
        id = getOrCreateStableCameraId(`${detectionWorkspace}::${fp}`);
      }
    } catch {
      // ignore migration failures
    }
  }

  const cam: CameraConfig = {
    id,
    name: raw.name,
    type: raw.type,
    status: raw.status,
    resolution: raw.resolution,
    fps: raw.fps,
    detectionWorkspace,
    cpuUsage: raw.cpuUsage,
    npuUsage: raw.npuUsage,
    model: typeof raw.model === "string" ? raw.model : undefined,
    inferenceSessionId: typeof raw.inferenceSessionId === "string" ? raw.inferenceSessionId : undefined,
    inferenceModelId: typeof raw.inferenceModelId === "string" ? raw.inferenceModelId : undefined,
    inferenceStartedAt: typeof raw.inferenceStartedAt === "number" ? raw.inferenceStartedAt : undefined,
    rtspUrl: typeof raw.rtspUrl === "string" ? raw.rtspUrl : undefined,
    device: typeof raw.device === "string" ? raw.device : undefined,
  };
  return cam;
}

/** Each detection tab only lists cameras added from that tab. Legacy cameras without `detectionWorkspace` show only under Person. */
function camerasForWorkspace(all: CameraConfig[], workspaceId: CameraWorkspaceId): CameraConfig[] {
  return all.filter((c) =>
    c.detectionWorkspace ? c.detectionWorkspace === workspaceId : workspaceId === "cameras",
  );
}

const Dashboard = () => {
  const [view, setView] = useState<DashboardView>("home");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedCamera, setSelectedCamera] = useState<CameraConfig | null>(null);
  const [cameras, setCameras] = useState<CameraConfig[]>([]);
  /** Where Live View should return (Overview vs which Cameras sidebar entry). */
  const [liveViewReturn, setLiveViewReturn] = useState<DashboardView>("home");

  const hydratedCameras = useMemo(() => {
    try {
      const raw = localStorage.getItem(CAMERAS_STORAGE_KEY);
      if (!raw) return [] as CameraConfig[];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [] as CameraConfig[];
      return parsed.map(sanitizeCamera).filter(Boolean) as CameraConfig[];
    } catch {
      return [] as CameraConfig[];
    }
  }, []);

  useEffect(() => {
    setCameras(hydratedCameras);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CAMERAS_STORAGE_KEY, JSON.stringify(cameras));
    } catch {
      // ignore quota / disabled storage
    }
  }, [cameras]);

  const handleOpenLiveView = (camera: CameraConfig) => {
    setLiveViewReturn(CAMERA_PANEL_VIEWS.includes(view) ? view : "home");
    setSelectedCamera(camera);
    setView("liveview");
  };

  const handleUpdateCamera = (cameraId: string, patch: Partial<CameraConfig>) => {
    setCameras((prev) => prev.map((c) => (c.id === cameraId ? { ...c, ...patch } : c)));
    setSelectedCamera((prev) => (prev && prev.id === cameraId ? { ...prev, ...patch } : prev));
  };

  const handleAddCamera = (camera: CameraConfig, opts?: { openLive?: boolean }) => {
    setCameras((prev) => [camera, ...prev]);
    if (opts?.openLive) {
      setLiveViewReturn(CAMERA_PANEL_VIEWS.includes(view) ? view : "home");
      setSelectedCamera(camera);
      setView("liveview");
    }
  };

  const handleDeleteCamera = (cameraId: string) => {
    setCameras((prev) => prev.filter((c) => c.id !== cameraId));
    setSelectedCamera((prev) => {
      if (!prev || prev.id !== cameraId) return prev;
      setView((v) => (v === "liveview" ? liveViewReturn : v));
      return null;
    });
  };

  const handleResetAll = () => {
    const sessions = cameras.map((c) => c.inferenceSessionId).filter(Boolean) as string[];
    // Stop any active sessions best-effort.
    void Promise.allSettled(
      sessions.map((sid) =>
        fetch(`/universal/api/inference/stop/${encodeURIComponent(sid)}`, { method: "POST" }).catch(() => null),
      ),
    ).finally(() => {
      try {
        localStorage.removeItem(CAMERAS_STORAGE_KEY);
      } catch {
        // ignore
      }
      setSelectedCamera(null);
      setCameras([]);
      void clearAllDetectionEvents();
      void clearExportRootDirectoryHandle();
      clearCameraRegistry();
      clearCameraIdMap();
      setView("cameras");
    });
  };

  const renderSuspended = (node: React.ReactNode) => {
    return (
      <Suspense
        fallback={
          <div className="w-full flex items-center justify-center py-10 text-sm text-muted-foreground">
            Loading…
          </div>
        }
      >
        {node}
      </Suspense>
    );
  };

  const renderView = () => {
    switch (view) {
      case "home":
        return renderSuspended(
          <DashboardHome
            cameras={cameras}
            onAddCamera={() => setView("cameras")}
            onViewCamera={handleOpenLiveView}
          />
        );
      case "cameras":
      case "cameras2":
      case "cameras3":
      case "cameras4":
        return renderSuspended(
          <CamerasView
            workspaceId={view}
            workspaceTitle={CAMERA_WORKSPACE_TITLE[view]}
            cameras={camerasForWorkspace(cameras, view)}
            onAddCamera={handleAddCamera}
            onUpdateCamera={handleUpdateCamera}
            onDeleteCamera={handleDeleteCamera}
            onOpenLiveView={handleOpenLiveView}
          />
        );
      case "liveview":
        return renderSuspended(
          <LiveViewScreen camera={selectedCamera} onBack={() => setView(liveViewReturn)} onUpdateCamera={handleUpdateCamera} />
        );
      case "services":
        return renderSuspended(<ServicesView />);
      case "events":
        return renderSuspended(<EventsView cameras={cameras} />);
      case "models":
        return renderSuspended(<ModelsView />);
      case "settings":
        return renderSuspended(<SettingsView onResetAll={handleResetAll} />);
      default:
        return renderSuspended(
          <DashboardHome
            cameras={cameras}
            onAddCamera={() => setView("cameras")}
            onViewCamera={handleOpenLiveView}
          />
        );
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background bg-app-mesh">
      <InferenceEventsRecorder
        cameras={cameras}
        // Avoid competing with Live View for the same session (some servers allow only one attach).
        excludeSessionId={view === "liveview" ? selectedCamera?.inferenceSessionId : undefined}
      />
      <DashboardSidebar
        currentView={view === "liveview" ? liveViewReturn : view}
        onNavigate={setView}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />
      <div className="flex-1 flex flex-col min-h-0">
        <DashboardTopBar onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
        <main className="flex-1 p-6 overflow-auto">
          {renderView()}
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
