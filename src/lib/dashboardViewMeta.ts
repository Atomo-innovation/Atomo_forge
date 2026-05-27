import type { DashboardView } from "@/pages/Dashboard";

export const DASHBOARD_VIEW_META: Partial<
  Record<DashboardView, { title: string; description: string }>
> = {
  home: {
    title: "Overview",
    description: "Cameras and recent activity across all detection workspaces.",
  },
  twin: {
    title: "Digital twin",
    description: "Live facility view with fire and person detection overlays.",
  },
  cameras: {
    title: "Person detection",
    description: "Manage cameras and review detections for person analytics.",
  },
  cameras2: {
    title: "Fire & smoke",
    description: "Manage cameras and review fire and smoke alerts.",
  },
  cameras3: {
    title: "Face recognition",
    description: "Cameras and detections with person name plus Known or Unknown from inference.",
  },
  cameras4: {
    title: "Safety",
    description: "PPE and safety compliance detection workspaces.",
  },
  events: {
    title: "Events",
    description: "Browse and export detection events from all cameras.",
  },
  models: {
    title: "AI models",
    description: "ASNN models from asnn-dashboard and on-device inference.",
  },
  settings: {
    title: "Settings",
    description: "Device profile, data management, and account options.",
  },
  services: {
    title: "Services",
    description: "System services and background processes.",
  },
};
