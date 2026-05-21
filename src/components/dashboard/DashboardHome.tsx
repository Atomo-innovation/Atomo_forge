import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Columns2, GripVertical, Maximize2, Plus, Camera, BarChart3, TrendingUp, Clock, Target, PencilLine } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CAMERA_WORKSPACE_TITLE, type CameraConfig, type CameraWorkspaceId } from "@/pages/Dashboard";
import { AddCameraModal } from "@/components/dashboard/AddCameraModal";
import { RenameCameraDialog } from "@/components/dashboard/RenameCameraDialog";
import {
  DETECTION_EVENTS_CHANGED_EVENT,
  listDetectionEvents,
  type StoredDetectionEvent,
} from "@/services/detectionEventsStore";
import { useModels } from "@/hooks/useModels";
import { getCameraFingerprint, getOrCreateStableCameraId } from "@/services/cameraIdentity";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  cameras: CameraConfig[];
  onAddCamera: (camera: CameraConfig, opts?: { openLive?: boolean }) => void;
  onUpdateCamera: (cameraId: string, patch: Partial<CameraConfig>) => void;
  onViewCamera: (camera: CameraConfig) => void;
  onOpenSettings?: () => void;
}

/** Legacy: array of panel ids only */
const STORAGE_KEY_V1 = "atomo-forge:dashboard-overview-order:v1";
/** Current: { order, spans } */
const STORAGE_KEY_V2 = "atomo-forge:dashboard-overview-layout:v2";

const PANEL_IDS = ["kpis", "cameras", "chart", "alerts"] as const;
type PanelId = (typeof PANEL_IDS)[number];

type WidthMode = "half" | "full";

const DEFAULT_ORDER: PanelId[] = [...PANEL_IDS];

const DEFAULT_SPANS: Record<PanelId, WidthMode> = {
  kpis: "half",
  cameras: "half",
  chart: "half",
  alerts: "half",
};

function normalizeOrder(raw: unknown): PanelId[] {
  const seen = new Set<PanelId>();
  const out: PanelId[] = [];
  if (Array.isArray(raw)) {
    for (const x of raw) {
      if (PANEL_IDS.includes(x as PanelId) && !seen.has(x as PanelId)) {
        seen.add(x as PanelId);
        out.push(x as PanelId);
      }
    }
  }
  for (const id of DEFAULT_ORDER) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

function normalizeSpans(raw: unknown): Record<PanelId, WidthMode> {
  const next = { ...DEFAULT_SPANS };
  if (!raw || typeof raw !== "object") return next;
  const o = raw as Record<string, string>;
  for (const id of PANEL_IDS) {
    if (o[id] === "full" || o[id] === "half") next[id] = o[id] as WidthMode;
  }
  return next;
}

function loadLayout(): { order: PanelId[]; spans: Record<PanelId, WidthMode> } {
  try {
    const v2 = localStorage.getItem(STORAGE_KEY_V2);
    if (v2) {
      const p = JSON.parse(v2) as { order?: unknown; spans?: unknown };
      if (p && typeof p === "object" && Array.isArray(p.order)) {
        return {
          order: normalizeOrder(p.order),
          spans: normalizeSpans(p.spans),
        };
      }
    }
    const v1 = localStorage.getItem(STORAGE_KEY_V1);
    if (v1) {
      const order = normalizeOrder(JSON.parse(v1));
      const layout = { order, spans: { ...DEFAULT_SPANS } };
      try {
        localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(layout));
      } catch {
        // ignore
      }
      return layout;
    }
  } catch {
    // ignore
  }
  return { order: [...DEFAULT_ORDER], spans: { ...DEFAULT_SPANS } };
}

function persistLayout(order: PanelId[], spans: Record<PanelId, WidthMode>) {
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify({ order, spans }));
  } catch {
    // ignore
  }
}

const ANALYTICS_STATS = [
  { icon: Target, label: "Total Detections", value: "24,891", sub: "+12% today", color: "text-primary", bg: "bg-primary/10" },
  { icon: BarChart3, label: "Alerts Today", value: "17", sub: "3 critical", color: "text-warning", bg: "bg-warning/10" },
] as const;

const CHART_SERIES = [
  { key: "cameras", label: "Person", barClass: "bg-primary/80", dotClass: "bg-primary" },
  { key: "cameras2", label: "Fire & Smoke", barClass: "bg-destructive/80", dotClass: "bg-destructive" },
  { key: "cameras3", label: "Face recognition", barClass: "bg-accent/80", dotClass: "bg-accent" },
  { key: "cameras4", label: "Safety", barClass: "bg-sky-500/80", dotClass: "bg-sky-500" },
  { key: "unknown", label: "Other", barClass: "bg-muted-foreground/40", dotClass: "bg-muted-foreground/60" },
] as const;
type ChartKey = (typeof CHART_SERIES)[number]["key"];

function formatDateTime(ts: number): string {
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
}

function SortablePanel({
  id,
  title,
  subtitle,
  actions,
  widthMode,
  onToggleWidth,
  children,
}: {
  id: PanelId;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  widthMode: WidthMode;
  onToggleWidth: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={`flex h-full min-h-0 flex-col rounded-xl border border-border/60 bg-card shadow-sm outline-none transition-shadow ${
        isDragging ? "z-20 scale-[1.01] opacity-[0.97] ring-2 ring-primary/30 shadow-lg" : ""
      }`}
    >
      <div className="flex flex-col gap-3 border-b border-border/50 bg-muted/15 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            className="mt-0.5 shrink-0 cursor-grab touch-manipulation rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
            aria-label={`Drag to reorder: ${title}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 pl-8 sm:ml-auto sm:pl-0">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleWidth();
            }}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/80 bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
            title={widthMode === "full" ? "One column" : "Full width row"}
            aria-label={widthMode === "full" ? "Switch to one column" : "Span full row width"}
          >
            {widthMode === "full" ? <Columns2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 p-4 sm:p-5">{children}</div>
    </section>
  );
}

const DashboardHome = ({ cameras, onAddCamera, onUpdateCamera, onViewCamera, onOpenSettings }: Props) => {
  const initial = useMemo(() => loadLayout(), []);
  const [order, setOrder] = useState<PanelId[]>(initial.order);
  const [spans, setSpans] = useState<Record<PanelId, WidthMode>>(initial.spans);
  const [overviewAddOpen, setOverviewAddOpen] = useState(false);
  const [overviewWorkspace, setOverviewWorkspace] = useState<CameraWorkspaceId>("cameras");
  const [renameTarget, setRenameTarget] = useState<CameraConfig | null>(null);
  const [recentEvents, setRecentEvents] = useState<StoredDetectionEvent[]>([]);
  const [chartEvents, setChartEvents] = useState<StoredDetectionEvent[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const thumbUrlsRef = useRef<Record<string, string>>({});
  const { models } = useModels();

  const modelsInUse = useMemo(() => {
    const ids = new Set<string>();
    for (const c of cameras) {
      if (!c?.inferenceSessionId) continue;
      const mid = c.inferenceModelId ?? "";
      if (mid) ids.add(mid);
    }
    return ids.size;
  }, [cameras]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const toggleWidth = useCallback((id: PanelId) => {
    setSpans((s) => {
      const next = { ...s, [id]: s[id] === "full" ? "half" : "full" } as Record<PanelId, WidthMode>;
      setOrder((o) => {
        persistLayout(o, next);
        return o;
      });
      return next;
    });
  }, []);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((o) => {
      const oldIndex = o.indexOf(active.id as PanelId);
      const newIndex = o.indexOf(over.id as PanelId);
      if (oldIndex < 0 || newIndex < 0) return o;
      const next = arrayMove(o, oldIndex, newIndex);
      persistLayout(next, spans);
      return next;
    });
  };

  const resetLayout = () => {
    setOrder([...DEFAULT_ORDER]);
    setSpans({ ...DEFAULT_SPANS });
    persistLayout([...DEFAULT_ORDER], { ...DEFAULT_SPANS });
  };

  useEffect(() => {
    const reload = () => {
      void listDetectionEvents().then(setRecentEvents).catch(() => setRecentEvents([]));
      // A bit more for charting (last 24h window will trim it down).
      void listDetectionEvents(2000).then(setChartEvents).catch(() => setChartEvents([]));
    };
    reload();
    const onChanged = () => reload();
    window.addEventListener(DETECTION_EVENTS_CHANGED_EVENT, onChanged as EventListener);
    return () => window.removeEventListener(DETECTION_EVENTS_CHANGED_EVENT, onChanged as EventListener);
  }, []);

  const chart = useMemo(() => {
    const now = Date.now();
    const start = now - 24 * 60 * 60 * 1000;
    const camById = new Map(cameras.map((c) => [c.id, c]));

    // Legacy compatibility: older events used a stable camera ID derived only from the input fingerprint,
    // which was shared across workspaces. We build a best-effort map from that legacy ID back to the
    // camera's current workspace so the chart shows the right colors (Face/Safety/etc.).
    const legacyWorkspaceByCameraId = new Map<string, CameraConfig["detectionWorkspace"]>();
    for (const c of cameras) {
      if (!c?.detectionWorkspace) continue;
      const fp = getCameraFingerprint({ type: c.type, rtspUrl: c.rtspUrl, device: c.device });
      if (!fp) continue;
      const legacyId = getOrCreateStableCameraId(fp);
      if (legacyId && legacyId !== c.id) legacyWorkspaceByCameraId.set(legacyId, c.detectionWorkspace);
    }

    const counts: Record<ChartKey, number> = { cameras: 0, cameras2: 0, cameras3: 0, cameras4: 0, unknown: 0 };
    let total = 0;
    for (const e of chartEvents) {
      if (!e?.createdAt || e.createdAt < start) break; // listDetectionEvents is newest-first
      const ws =
        camById.get(e.cameraId)?.detectionWorkspace ??
        legacyWorkspaceByCameraId.get(e.cameraId) ??
        "unknown";
      const key = (CHART_SERIES.some((s) => s.key === ws) ? ws : "unknown") as ChartKey;
      counts[key] += 1;
      total += 1;
    }

    return { counts, total };
  }, [cameras, chartEvents]);

  const donutStops = useMemo(() => {
    // Build conic-gradient stops like: "color 0deg Xdeg, color Xdeg Ydeg, ..."
    const total = chart.total || 0;
    if (!total) {
      return "hsl(var(--muted)) 0deg 360deg";
    }

    const segments = CHART_SERIES.map((s) => ({ key: s.key as ChartKey, color: s.dotClass, value: chart.counts[s.key as ChartKey] ?? 0 }))
      .filter((x) => x.value > 0);

    if (segments.length === 0) return "hsl(var(--muted)) 0deg 360deg";

    // Map dotClass -> HSL var. Keep palette consistent with theme.
    const classToColor = (dotClass: string) => {
      if (dotClass.includes("bg-primary")) return "hsl(var(--primary))";
      if (dotClass.includes("bg-warning")) return "hsl(var(--warning))";
      if (dotClass.includes("bg-accent")) return "hsl(var(--accent))";
      if (dotClass.includes("bg-success")) return "hsl(var(--success))";
      if (dotClass.includes("bg-destructive")) return "hsl(var(--destructive))";
      if (dotClass.includes("bg-sky-500")) return "hsl(199 89% 48%)";
      return "hsl(var(--muted))";
    };

    let cur = 0;
    const parts: string[] = [];
    for (const seg of segments) {
      const deg = (seg.value / total) * 360;
      const next = cur + deg;
      parts.push(`${classToColor(seg.color)} ${cur}deg ${next}deg`);
      cur = next;
    }
    // Ensure full 360 coverage (avoid rounding gap).
    if (cur < 360) parts[parts.length - 1] = parts[parts.length - 1].replace(/\d+(\.\d+)?deg\s*$/, "360deg");
    return parts.join(", ");
  }, [chart.counts, chart.total]);

  useEffect(() => {
    const prev = thumbUrlsRef.current;
    const next: Record<string, string> = {};

    for (const e of recentEvents) {
      const existing = prev[e.id];
      next[e.id] = existing ?? URL.createObjectURL(e.cropImage);
    }

    for (const [id, url] of Object.entries(prev)) {
      if (!next[id]) URL.revokeObjectURL(url);
    }

    thumbUrlsRef.current = next;
    setThumbUrls(next);
  }, [recentEvents]);

  useEffect(() => {
    return () => {
      const cur = thumbUrlsRef.current;
      for (const url of Object.values(cur)) URL.revokeObjectURL(url);
      thumbUrlsRef.current = {};
    };
  }, []);

  const isDefaultLayout = useMemo(
    () =>
      order.join(",") === DEFAULT_ORDER.join(",") && PANEL_IDS.every((id) => spans[id] === "half"),
    [order, spans],
  );

  const renderPanel = (id: PanelId) => {
    const wm = spans[id];
    const tw = () => toggleWidth(id);

    switch (id) {
      case "kpis":
        return (
          <SortablePanel id="kpis" title="Key metrics" subtitle="Detection and performance summary" widthMode={wm} onToggleWidth={tw}>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
              {ANALYTICS_STATS.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl border border-border/40 bg-background/60 p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5"
                >
                  <div className={`inline-flex rounded-lg p-2 ${stat.bg}`}>
                    <stat.icon className={`h-4 w-4 ${stat.color}`} />
                  </div>
                  <p className="mt-3 text-xs font-medium text-muted-foreground">{stat.label}</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight sm:text-3xl">{stat.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{stat.sub}</p>
                </div>
              ))}
            </div>
          </SortablePanel>
        );

      case "cameras":
        return (
          <SortablePanel
            id="cameras"
            title="Cameras"
            subtitle="Camera name, detection workspace, and AI status"
            widthMode={wm}
            onToggleWidth={tw}
          >
            <div className="flex flex-col">
              {cameras.length > 0 ? (
                <>
                  <div
                    className={`grid grid-cols-1 gap-4 ${
                      wm === "full"
                        ? "sm:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] lg:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]"
                        : "sm:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]"
                    }`}
                  >
                    {cameras.map((cam) => (
                      <div
                        key={cam.id}
                        className={`flex min-h-[7.5rem] overflow-hidden rounded-xl border border-border/40 bg-muted/30 transition-all hover:border-primary/30 hover:bg-muted/50 ${
                          wm === "full" ? "min-h-0" : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onViewCamera(cam)}
                          className="group min-w-0 flex-1 p-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        >
                          <h3 className="font-semibold leading-snug transition-colors group-hover:text-primary">{cam.name}</h3>
                          <p className="mt-2 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground/90">Detection: </span>
                            {cam.detectionWorkspace ? (
                              <span className="inline-flex max-w-full items-center rounded-md border border-primary/25 bg-primary/8 px-2 py-0.5 font-medium text-primary">
                                {CAMERA_WORKSPACE_TITLE[cam.detectionWorkspace]}
                              </span>
                            ) : (
                              <span className="text-muted-foreground" title="Cameras added before workspace labels were saved">
                                Not set
                              </span>
                            )}
                          </p>
                          <p className="mt-1.5 text-sm text-muted-foreground">
                            {cam.inferenceSessionId ? (
                              <>
                                <span className="font-medium text-success">AI Running</span>
                                {cam.model ? (
                                  <>
                                    {" "}
                                    <span className="text-muted-foreground">·</span> <span className="text-foreground">{cam.model}</span>
                                  </>
                                ) : null}
                              </>
                            ) : (
                              <span>AI Stopped</span>
                            )}
                          </p>
                        </button>
                        <div className="flex shrink-0 flex-col border-l border-border/50 bg-muted/20">
                          <button
                            type="button"
                            onClick={() => setRenameTarget(cam)}
                            className="flex flex-1 items-center justify-center px-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            aria-label={`Rename ${cam.name}`}
                          >
                            <PencilLine className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-8 flex justify-center">
                    <button
                      type="button"
                      onClick={() => setOverviewAddOpen(true)}
                      className="inline-flex items-center gap-2 rounded-lg bg-gradient-atomic px-6 py-3 font-medium text-primary-foreground glow-primary transition-transform hover:scale-[1.02]"
                    >
                      <Plus className="h-5 w-5" /> Add Camera
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex min-h-[14rem] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 py-12 text-center sm:min-h-[16rem] sm:py-16">
                  <Camera className="h-14 w-14 shrink-0 text-muted-foreground/30 sm:h-16 sm:w-16" aria-hidden />
                  <button
                    type="button"
                    onClick={() => setOverviewAddOpen(true)}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gradient-atomic px-6 py-3 font-medium text-primary-foreground glow-primary transition-transform hover:scale-[1.02]"
                  >
                    <Plus className="h-5 w-5" aria-hidden /> Add Camera
                  </button>
                  <h3 className="mt-8 text-lg font-medium">No cameras connected</h3>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Add a camera here or from a detection workspace in the sidebar.
                  </p>
                </div>
              )}
            </div>
          </SortablePanel>
        );

      case "chart":
        return (
          <SortablePanel id="chart" title="Detections" subtitle="Last 24 hours (live)" widthMode={wm} onToggleWidth={tw}>
            <div className={`flex flex-col items-center ${wm === "full" ? "sm:flex-row sm:items-center sm:justify-center sm:gap-12" : ""}`}>
              <div className="relative h-44 w-44 shrink-0 sm:h-48 sm:w-48" role="img" aria-label="Detection mix over last 24 hours">
                <div
                  className="absolute inset-0 rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                  style={{
                    background: `conic-gradient(from -90deg, ${donutStops})`,
                  }}
                />
                <div className="absolute inset-[18%] rounded-full bg-card shadow-sm ring-1 ring-border" />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">24h</p>
                    <p className="text-xl font-bold tabular-nums leading-tight sm:text-2xl">{chart.total.toLocaleString()}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">detections</p>
                  </div>
                </div>
              </div>

              <ul
                className={`mt-6 grid w-full gap-x-4 gap-y-2.5 text-sm sm:mt-0 ${
                  wm === "full" ? "max-w-md grid-cols-2 sm:grid-cols-2 lg:max-w-lg" : "max-w-[280px] grid-cols-2"
                }`}
              >
                {CHART_SERIES.map((item) => {
                  const v = chart.counts[item.key as ChartKey] ?? 0;
                  return (
                    <li key={item.key} className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.dotClass}`} />
                      <span className="truncate text-muted-foreground">
                        {item.label} <span className="text-muted-foreground/60">·</span>{" "}
                        <span className="font-medium text-foreground/90">{v.toLocaleString()}</span>
                      </span>
                    </li>
                  );
                })}
                <li className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-violet-500" />
                  <span className="truncate text-muted-foreground">
                    Models in use <span className="text-muted-foreground/60">·</span>{" "}
                    <span className="font-medium text-foreground/90">{modelsInUse.toLocaleString()}</span>
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-indigo-500" />
                  <span className="truncate text-muted-foreground">
                    Total models <span className="text-muted-foreground/60">·</span>{" "}
                    <span className="font-medium text-foreground/90">{models.length.toLocaleString()}</span>
                  </span>
                </li>
              </ul>
            </div>
          </SortablePanel>
        );

      case "alerts":
        return (
          <SortablePanel id="alerts" title="Recent Alerts" subtitle="Latest detections with image crops" widthMode={wm} onToggleWidth={tw}>
            {recentEvents.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/15 p-6 text-sm text-muted-foreground">
                No detections yet. Start inference on any camera to see recent detections here.
              </div>
            ) : (
              <ul className={`space-y-2 overflow-y-auto max-h-[420px] ${wm === "full" ? "sm:columns-2 sm:gap-x-6 sm:gap-y-2 sm:[&>li]:break-inside-avoid" : ""}`}>
                {recentEvents.map((e) => (
                  <li
                    key={e.id}
                    className="flex gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 transition-colors hover:bg-destructive/10"
                  >
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-destructive" />
                    <div className="h-12 w-16 shrink-0 overflow-hidden rounded-md border border-border/60 bg-background">
                      {thumbUrls[e.id] ? (
                        <img src={thumbUrls[e.id]} alt={e.label} className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full bg-muted" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[11px] font-mono text-muted-foreground">{formatDateTime(e.createdAt)}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="truncate text-sm font-semibold text-destructive">{e.label}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        <span className="truncate">Camera: {e.cameraName ?? e.cameraId}</span>
                        {cameras.find((c) => c.id === e.cameraId)?.detectionWorkspace ? (
                          <>
                            {" "}
                            <span className="text-muted-foreground">·</span>{" "}
                            <span className="font-medium text-primary/90">
                              {CAMERA_WORKSPACE_TITLE[cameras.find((c) => c.id === e.cameraId)!.detectionWorkspace!]}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SortablePanel>
        );

      default:
        return null;
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] animate-fade-in">
      <header className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            On large screens, panels use <span className="font-medium text-foreground">two columns</span>. Use the width
            control and grip in each header to adjust size and order. Layout is saved on this device.
          </p>
        </div>
        <button
          type="button"
          onClick={resetLayout}
          disabled={isDefaultLayout}
          className="self-start rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 sm:self-auto"
        >
          Reset layout
        </button>
      </header>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-stretch lg:gap-6 xl:gap-8">
            {order.map((id) => (
              <div
                key={id}
                className={`min-h-0 min-w-0 ${spans[id] === "full" ? "lg:col-span-2" : ""}`}
              >
                {renderPanel(id)}
              </div>
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <AddCameraModal
        open={overviewAddOpen}
        onClose={() => setOverviewAddOpen(false)}
        workspaceId={overviewWorkspace}
        workspaceTitle={CAMERA_WORKSPACE_TITLE[overviewWorkspace]}
        showWorkspacePicker
        onWorkspaceChange={setOverviewWorkspace}
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

export default DashboardHome;
