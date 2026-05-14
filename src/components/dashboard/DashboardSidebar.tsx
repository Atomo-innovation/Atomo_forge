import { LayoutDashboard, User, Flame, ScanFace, Shield, Bell, Brain, Settings, ChevronLeft, Box } from "lucide-react";
import type { DashboardView } from "@/pages/Dashboard";

/** Served from `public/al.png` (respects Vite `base` via `import.meta.env.BASE_URL`). */
const SIDEBAR_LOGO_SRC = `${import.meta.env.BASE_URL}al.png`;

interface Props {
  currentView: DashboardView;
  onNavigate: (view: DashboardView) => void;
  open: boolean;
  onToggle: () => void;
}

const navItems: { id: DashboardView; label: string; icon: React.ElementType }[] = [
  { id: "home", label: "Overview", icon: LayoutDashboard },
  { id: "twin", label: "Twin", icon: Box },
  { id: "cameras", label: "Person", icon: User },
  { id: "cameras2", label: "Fire & Smoke", icon: Flame },
  { id: "cameras3", label: "Face recognition", icon: ScanFace },
  { id: "cameras4", label: "Safety", icon: Shield },
  { id: "events", label: "Events", icon: Bell },
  { id: "models", label: "Models", icon: Brain },
  { id: "settings", label: "Settings", icon: Settings },
];

const DashboardSidebar = ({ currentView, onNavigate, open, onToggle }: Props) => {
  return (
    <aside
      className={`${
        open ? "w-60" : "w-16"
      } bg-sidebar border-r border-sidebar-border flex flex-col transition-[width] duration-300 ease-out shrink-0 sticky top-0 h-screen overflow-hidden`}
    >
      {/* Brand strip: expanded = logo + wordmark + toggle; collapsed = stacked mark + toggle */}
      <div
        className={
          open
            ? "flex h-[4.25rem] shrink-0 items-center gap-2 border-b border-sidebar-border px-3"
            : "flex shrink-0 flex-col items-center gap-2.5 border-b border-sidebar-border px-2 py-3"
        }
      >
        {open ? (
          <>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-sidebar-accent/60 ring-1 ring-sidebar-border/80 shadow-inner">
                <img
                  src={SIDEBAR_LOGO_SRC}
                  alt=""
                  width={729}
                  height={756}
                  decoding="async"
                  className="h-8 w-8 object-contain"
                  aria-hidden
                />
              </div>
              <div className="min-w-0 flex-1 leading-none">
                <p className="text-gradient truncate text-xl font-bold tracking-tight">Atomo</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onToggle}
              className="shrink-0 rounded-lg p-2 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-sidebar-accent/60 ring-1 ring-sidebar-border/80 shadow-inner"
              title="Atomo"
            >
              <img
                src={SIDEBAR_LOGO_SRC}
                alt="Atomo"
                width={729}
                height={756}
                decoding="async"
                className="h-8 w-8 object-contain"
              />
            </div>
            <button
              type="button"
              onClick={onToggle}
              className="rounded-lg p-1.5 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              aria-label="Expand sidebar"
            >
              <ChevronLeft className="h-4 w-4 rotate-180" />
            </button>
          </>
        )}
      </div>

      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const active = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground"
              }`}
            >
              <item.icon className={`w-5 h-5 shrink-0 ${active ? "text-sidebar-accent-foreground" : "text-sidebar-foreground"}`} />
              {open && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {open && (
        <div className="p-4 border-t border-sidebar-border">
          <div className="text-xs text-muted-foreground">
            Atomo Processing Unit
            <br />
            <span className="font-mono text-[10px]">v2.1.0 • Electron</span>
          </div>
        </div>
      )}
    </aside>
  );
};

export default DashboardSidebar;
