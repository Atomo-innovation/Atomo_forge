import {
  LayoutDashboard,
  User,
  Flame,
  ScanFace,
  Shield,
  Bell,
  Brain,
  Settings,
  ChevronLeft,
  Box,
  Cpu,
} from "lucide-react";
import { useState, useEffect } from "react";
import type { DashboardView } from "@/pages/Dashboard";
import { loadDynamicWorkspaces } from "@/pages/Dashboard";
import { EVENTS_TAB_ENABLED } from "@/lib/featureFlags";
import { cn } from "@/lib/utils";

const SIDEBAR_LOGO_SRC = `${import.meta.env.BASE_URL}al.png`;

interface Props {
  currentView: DashboardView;
  onNavigate: (view: DashboardView) => void;
  open: boolean;
  onToggle: () => void;
  onModelRemoved?: (removedWorkspaceIds: string[]) => void;
}

type NavItem = {
  id: DashboardView;
  label: string;
  icon: React.ElementType;
};

const DashboardSidebar = ({ currentView, onNavigate, open, onToggle, onModelRemoved }: Props) => {
  const [dynamicWorkspaces, setDynamicWorkspaces] = useState<Record<string, string>>(loadDynamicWorkspaces());

  useEffect(() => {
    const onStorage = () => setDynamicWorkspaces(loadDynamicWorkspaces());
    window.addEventListener("storage", onStorage);
    setDynamicWorkspaces(loadDynamicWorkspaces());
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const dynamicItems = Object.entries(dynamicWorkspaces).map(([id, title]) => ({
    id: id as DashboardView,
    label: title,
    icon: Cpu,
  }));

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Main",
    items: [
      { id: "home", label: "Overview", icon: LayoutDashboard },
      { id: "twin", label: "Digital twin", icon: Box },
    ],
  },
  {
    label: "Detection",
    items: [
      { id: "cameras", label: "Person", icon: User },
      { id: "cameras2", label: "Fire & smoke", icon: Flame },
      { id: "cameras3", label: "Face recognition", icon: ScanFace },
      { id: "cameras4", label: "Safety", icon: Shield },
      ...dynamicItems,
    ],
  },
  {
    label: "System",
    items: [
      ...(EVENTS_TAB_ENABLED ? [{ id: "events" as const, label: "Events", icon: Bell }] : []),
      { id: "models", label: "AI models", icon: Brain },
      { id: "settings", label: "Settings", icon: Settings },
    ],
  },
];

return (
    <aside
      className={cn(
        "dashboard-sidebar flex h-screen shrink-0 flex-col overflow-hidden border-r border-sidebar-border transition-[width] duration-300 ease-out",
        open ? "w-64" : "w-[4.25rem]",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 border-b border-sidebar-border",
          open ? "h-16 items-center gap-2 px-4" : "flex-col items-center gap-2 py-4 px-2",
        )}
      >
        {open ? (
          <>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sidebar-accent ring-1 ring-sidebar-border">
                <img src={SIDEBAR_LOGO_SRC} alt="" width={729} height={756} decoding="async" className="h-7 w-7 object-contain" aria-hidden />
              </div>
              <div className="min-w-0 leading-none">
                <p className="truncate text-lg font-semibold tracking-tight text-sidebar-foreground">Atomo</p>
                <p className="truncate text-[11px] text-sidebar-foreground/55">Forge Suite</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onToggle}
              className="shrink-0 rounded-lg p-2 text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-sidebar-accent ring-1 ring-sidebar-border" title="Atomo">
              <img src={SIDEBAR_LOGO_SRC} alt="Atomo" width={729} height={756} decoding="async" className="h-7 w-7 object-contain" />
            </div>
            <button
              type="button"
              onClick={onToggle}
              className="rounded-lg p-1.5 text-sidebar-foreground/80 hover:bg-sidebar-accent"
              aria-label="Expand sidebar"
            >
              <ChevronLeft className="h-4 w-4 rotate-180" />
            </button>
          </>
        )}
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-2 py-4">
        {navGroups.map((group) => (
          <div key={group.label}>
            {open ? (
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
            ) : (
              <div className="mx-auto mb-2 h-px w-8 bg-sidebar-border" aria-hidden />
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = currentView === item.id;
                return (
                  <li key={item.id}>
                    <div
                      className={cn(
                        "flex w-full items-center gap-0.5 rounded-lg transition-colors",
                        active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/70",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onNavigate(item.id)}
                        title={!open ? item.label : undefined}
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-3 py-2.5 text-sm font-medium transition-colors",
                          open ? "px-3" : "justify-center px-0",
                          active
                            ? cn("text-sidebar-foreground", open && "border-l-2 border-primary pl-[10px]")
                            : cn(
                                "text-sidebar-foreground/70 hover:text-sidebar-foreground",
                                open && "border-l-2 border-transparent pl-[10px]",
                              ),
                        )}
                      >
                        <item.icon
                          className={cn(
                            "h-[1.125rem] w-[1.125rem] shrink-0",
                            active ? "text-primary" : "text-sidebar-foreground/60",
                          )}
                        />
                        {open ? <span className="truncate">{item.label}</span> : null}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {open ? (
        <div className="border-t border-sidebar-border px-4 py-4">
          <p className="text-xs text-muted-foreground">Atomo Processing Unit</p>
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/80">v2.1.0</p>
        </div>
      ) : null}
    </aside>
  );
};

export default DashboardSidebar;
