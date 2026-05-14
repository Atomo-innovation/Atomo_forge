import { Wifi, Menu, Thermometer, Cpu, Activity, Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";
import { getThemeMode, setThemeMode, type ThemeMode } from "@/services/themeMode";
import {
  DEVICE_PROFILE_CHANGED_EVENT,
  getDeviceProfile,
  type DeviceProfile,
} from "@/services/deviceProfile";
import { useAuthUsername } from "@/contexts/AuthUsernameContext";

interface Props {
  onToggleSidebar: () => void;
}

const StatusPill = ({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color: string }) => (
  <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-muted/50 px-3 py-1.5 backdrop-blur-sm dark:bg-muted/35">
    <Icon className={`h-3.5 w-3.5 ${color}`} />
    <span className="hidden text-xs text-muted-foreground md:inline">{label}</span>
    <span className="font-mono text-xs font-semibold tabular-nums text-foreground">{value}</span>
  </div>
);

const DashboardTopBar = ({ onToggleSidebar }: Props) => {
  const sessionUser = useAuthUsername();
  const [mode, setMode] = useState<ThemeMode>("dark");
  const [profile, setProfile] = useState<DeviceProfile | null>(null);

  useEffect(() => setMode(getThemeMode()), []);

  useEffect(() => {
    const refresh = () =>
      setProfile(getDeviceProfile(sessionUser ?? undefined));
    refresh();
    window.addEventListener(DEVICE_PROFILE_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(DEVICE_PROFILE_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [sessionUser]);

  const toggle = () => {
    const next: ThemeMode = mode === "dark" ? "light" : "dark";
    setMode(next);
    setThemeMode(next);
  };

  const deviceName = profile?.deviceName?.trim() || "Atomo Device";
  const orgName = profile?.organizationName?.trim();
  const serial = profile?.serialNumber?.trim() || "APU-2026-E7K3";

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border/80 bg-card/90 px-4 shadow-sm backdrop-blur-md dark:bg-card/75 md:px-6">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-2 w-2 animate-pulse rounded-full bg-success shadow-[0_0_10px_hsl(var(--success)/0.65)]" />
          <div className="flex flex-col min-w-0 leading-tight">
            <span className="text-sm font-semibold tracking-tight truncate" title={deviceName}>
              {deviceName}
            </span>
            {sessionUser ? (
              <span
                className="text-[10px] text-muted-foreground truncate -mt-0.5"
                title={`Signed in as ${sessionUser}`}
              >
                @{sessionUser}
              </span>
            ) : null}
            <span className="font-mono text-[11px] text-muted-foreground truncate" title={orgName ? `${orgName} • ${serial}` : serial}>
              {orgName ? `${orgName} • ` : ""}
              {serial}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          className="group relative flex h-10 items-center gap-1 rounded-full border border-border/90 bg-gradient-to-b from-card to-muted/40 p-1 shadow-inner dark:from-card dark:to-muted/25"
          aria-label={mode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={mode === "dark" ? "Light mode" : "Dark mode"}
        >
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-all duration-300 ${
              mode === "light"
                ? "bg-gradient-atomic text-primary-foreground shadow-md glow-primary-sm"
                : "text-muted-foreground group-hover:text-foreground"
            }`}
          >
            <Sun className="h-4 w-4" />
          </span>
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-all duration-300 ${
              mode === "dark"
                ? "bg-gradient-atomic text-primary-foreground shadow-md glow-primary-sm"
                : "text-muted-foreground group-hover:text-foreground"
            }`}
          >
            <Moon className="h-4 w-4" />
          </span>
        </button>
        <StatusPill icon={Cpu} label="CPU" value="23%" color="text-primary" />
        <StatusPill icon={Activity} label="NPU" value="67%" color="text-accent" />
        <StatusPill icon={Thermometer} label="Temp" value="42°C" color="text-success" />
        <StatusPill icon={Wifi} label="Network" value="1Gbps" color="text-primary" />
      </div>
    </header>
  );
};

export default DashboardTopBar;
