import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, LogOut, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuthUsername } from "@/contexts/AuthUsernameContext";
import {
  DEVICE_PROFILE_CHANGED_EVENT,
  getDeviceProfile,
  setDeviceProfile,
} from "@/services/deviceProfile";
import { fetchDeviceRegistrations, deviceProfileFromRegistrationRow, type ByEmail, type RegistrationRow, type FetchRegistrationsErr } from "@/services/deviceRegistrations";
import { PageHeader } from "@/components/layout/PageHeader";
import { DASHBOARD_VIEW_META } from "@/lib/dashboardViewMeta";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function formatDt(value: string | Date | null | undefined): string {
  if (value == null) return "—";
  try {
    const d = typeof value === "string" ? new Date(value) : value;
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

const SettingsView = ({
  onResetAll,
  onLogout,
  onSwitchDashboardDevice,
}: {
  onResetAll: () => void;
  onLogout: () => void;
  /** After picking a unit, jump to Overview so the user sees that device’s dashboard context. */
  onSwitchDashboardDevice?: () => void;
}) => {
  
  const meshUsername = useAuthUsername();
  const [devices, setDevices] = useState<RegistrationRow[]>([]);
  const [byEmail, setByEmail] = useState<ByEmail[]>([]);
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [regBanner, setRegBanner] = useState<string | null>(null);

  const profileEmail = meshUsername ? getDeviceProfile(meshUsername)?.email?.trim().toLowerCase() ?? null : null;

  /** Re-render when local device profile changes (e.g. after “Use on dashboard”). */
  const [profileEpoch, setProfileEpoch] = useState(0);
  useEffect(() => {
    const onProfile = () => setProfileEpoch((n) => n + 1);
    window.addEventListener(DEVICE_PROFILE_CHANGED_EVENT, onProfile);
    window.addEventListener("storage", onProfile);
    return () => {
      window.removeEventListener(DEVICE_PROFILE_CHANGED_EVENT, onProfile);
      window.removeEventListener("storage", onProfile);
    };
  }, []);

  const dashboardSerialActive = useMemo(() => {
    void profileEpoch;
    if (!meshUsername) return null;
    return getDeviceProfile(meshUsername)?.serialNumber?.trim() ?? null;
  }, [meshUsername, profileEpoch]);

  const applyDeviceToDashboard = useCallback(
    (d: RegistrationRow) => {
      if (!meshUsername) return;
      setDeviceProfile(meshUsername, deviceProfileFromRegistrationRow(d));
      toast.success("Dashboard updated", {
        description: `Showing “${d.deviceName.trim()}” (${d.serialNumber.trim()})`,
      });
      onSwitchDashboardDevice?.();
    },
    [meshUsername, onSwitchDashboardDevice],
  );

  const loadRegistrations = useCallback(async () => {
    if (!meshUsername) {
      setDevices([]);
      setByEmail([]);
      setRegBanner(null);
      return;
    }
    setRegLoading(true);
    setRegError(null);
    setRegBanner(null);
    try {
      const result = await fetchDeviceRegistrations(meshUsername, profileEmail);
      if (!result.ok) {
        setRegError((result as FetchRegistrationsErr).error);
        setDevices([]);
        setByEmail([]);
        return;
      }
      setDevices(result.devices);
      setByEmail(result.byEmail);
      if (typeof result.schemaNote === "string" && result.schemaNote.trim()) {
        setRegBanner(result.schemaNote.trim());
      } else if (result.migrationNeeded && typeof result.hint === "string" && result.hint.trim()) {
        setRegBanner(result.hint.trim());
      }
    } catch (e) {
      setRegError(e instanceof Error ? e.message : "Failed to load settings");
      setDevices([]);
      setByEmail([]);
    } finally {
      setRegLoading(false);
    }
  }, [meshUsername, profileEmail]);

  useEffect(() => {
    void loadRegistrations();
  }, [loadRegistrations]);

  const meta = DASHBOARD_VIEW_META.settings;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={meta?.title ?? "Settings"}
        description={meta?.description ?? "Device configuration and integrations"}
      />

      {regError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {regError}
        </div>
      ) : null}
      {regLoading ? <p className="text-sm text-muted-foreground">Loading account data…</p> : null}

      {/* Device registrations UI removed per user request; underlying logic kept. */}

      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <LogOut className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <div className="font-semibold text-foreground">Sign out</div>
              <div className="text-sm text-muted-foreground mt-1">
                End your session on this browser. Device registration on this machine stays saved until you clear browser data or reset it below.
              </div>
            </div>
          </div>
          <Button variant="outline" className="shrink-0" onClick={onLogout}>
            <LogOut className="w-4 h-4 mr-2" />
            Log out
          </Button>
        </div>
      </div>

      {/* "Register another device" panel removed per user request. */}

      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
            <Trash2 className="w-5 h-5 text-destructive" />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-foreground">Reset local data</div>
            <div className="text-sm text-muted-foreground">
              Clears saved cameras, saved events, and unlinks any export folder on this browser. Use this when you want a clean start.
            </div>
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">Reset everything…</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset everything?</AlertDialogTitle>
              <AlertDialogDescription>
                This will stop any running AI sessions, delete all cameras and all detection events from this browser, and unlink the disk export folder (if linked).
                Exported files already written to disk will remain.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={onResetAll}
              >
                Reset
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="space-y-4">
        {[
          { icon: Bell, title: "Alert Configuration", desc: "Set up alert triggers, thresholds, and notification channels" },
        ].map((item) => (
          <button
            key={item.title}
            className="w-full bg-surface rounded-xl p-5 flex items-center gap-4 text-left hover:border-primary/30 transition-all"
          >
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <item.icon className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold">{item.title}</h3>
              <p className="text-sm text-muted-foreground">{item.desc}</p>
            </div>
            <span className="text-muted-foreground">→</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default SettingsView;
