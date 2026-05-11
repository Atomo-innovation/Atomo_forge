import { LayoutDashboard, User, Flame, ScanFace, Shield, Bell, Brain, Settings, ChevronLeft } from "lucide-react";
import type { DashboardView } from "@/pages/Dashboard";
import atomoLogo from "@/assets/atomo-logo-light.png";

interface Props {
  currentView: DashboardView;
  onNavigate: (view: DashboardView) => void;
  open: boolean;
  onToggle: () => void;
}

const navItems: { id: DashboardView; label: string; icon: React.ElementType }[] = [
  { id: "home", label: "Overview", icon: LayoutDashboard },
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
      } bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300 shrink-0 sticky top-0 h-screen overflow-hidden`}
    >
      <div className="h-16 flex items-center px-4 border-b border-sidebar-border justify-between">
        {open && (
          <img
            src={atomoLogo}
            alt="Atomo"
            className="h-7 w-auto object-contain object-left drop-shadow-sm"
          />
        )}
        <button onClick={onToggle} className="p-1.5 rounded-md hover:bg-sidebar-accent text-sidebar-foreground transition-colors">
          <ChevronLeft className={`w-4 h-4 transition-transform ${!open ? "rotate-180" : ""}`} />
        </button>
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
