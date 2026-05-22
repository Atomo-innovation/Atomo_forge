import { Wifi, Menu, Thermometer, Cpu, Activity, Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";
import { getThemeMode, setThemeMode, type ThemeMode } from "@/services/themeMode";
import {
  DEVICE_PROFILE_CHANGED_EVENT,
  getDeviceProfile,
  type DeviceProfile,
} from "@/services/deviceProfile";
import { useAuthUsername } from "@/contexts/AuthUsernameContext";
import { cn } from "@/lib/utils";

interface Props {
  onToggleSidebar: () => void;
}

const StatusPill = ({
  icon: Icon,
  label,
  value,
  color,
  className,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  color: string;
  className?: string;
}) => (
  <div
    className={cn(
      "flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5",
      className,
    )}
  >
    <Icon className={cn("h-3.5 w-3.5", color)} />
    <span className="hidden text-[11px] text-muted-foreground lg:inline">{label}</span>
    <span className="font-mono text-xs font-medium tabular-nums text-foreground">{value}</span>
  </div>
);

const DashboardTopBar = ({ onToggleSidebar }: Props) => {
  const sessionUser = useAuthUsername();
  const [mode, setMode] = useState<ThemeMode>("dark");
  const [profile, setProfile] = useState<DeviceProfile | null>(null);

  useEffect(() => setMode(getThemeMode()), []);

  useEffect(() => {
    const refresh = () => setProfile(getDeviceProfile(sessionUser ?? undefined));
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
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border/80 bg-card/95 px-4 backdrop-blur-md md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-40" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold text-foreground" title={deviceName}>
              {deviceName}
            </p>
            <p className="truncate font-mono text-[11px] text-muted-foreground" title={orgName ? `${orgName} · ${serial}` : serial}>
              {sessionUser ? `@${sessionUser} · ` : ""}
              {orgName ? `${orgName} · ` : ""}
              {serial}
            </p>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={toggle}
          className="flex h-9 items-center gap-0.5 rounded-lg border border-border/70 bg-muted/30 p-0.5"
          aria-label={mode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
              mode === "light" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            <Sun className="h-3.5 w-3.5" />
          </span>
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
              mode === "dark" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            <Moon className="h-3.5 w-3.5" />
          </span>
        </button>
        <div className="hidden items-center gap-1.5 md:flex">
          <StatusPill icon={Cpu} label="CPU" value="23%" color="text-primary" />
          <StatusPill icon={Activity} label="NPU" value="67%" color="text-accent" />
          <StatusPill icon={Thermometer} label="Temp" value="42°C" color="text-success" />
          <StatusPill icon={Wifi} label="Net" value="1G" color="text-primary" className="hidden xl:flex" />
        </div>
      </div>
    </header>
  );
};

export default DashboardTopBar;
