import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Cpu, List, LogOut, RefreshCw, Shield, Webhook, FileDown, Users, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNavigate } from "react-router-dom";
import { useAuthUsername } from "@/contexts/AuthUsernameContext";
import {
  DEVICE_PROFILE_CHANGED_EVENT,
  getDeviceProfile,
  setDeviceProfile,
} from "@/services/deviceProfile";
import { fetchDeviceRegistrations, type ByEmail, type RegistrationRow } from "@/services/deviceRegistrations";
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
  const navigate = useNavigate();
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
        setRegError(result.error);
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
    } finally {
      setRegLoading(false);
    }
  }, [meshUsername, profileEmail]);

  useEffect(() => {
    void loadRegistrations();
  }, [loadRegistrations]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold mb-1">Settings</h1>
        <p className="text-muted-foreground">Device configuration and integrations</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <List className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="font-semibold text-foreground">Your device registrations</div>
              <p className="text-sm text-muted-foreground mt-1">
                Rows from MySQL for <span className="font-mono text-foreground">@{meshUsername ?? "—"}</span>.{" "}
                <span className="font-medium text-foreground">Use on dashboard</span> switches what the top bar and overview use on{" "}
                <span className="font-medium text-foreground">this browser</span> — no need to register again.{" "}
                <span className="font-medium text-foreground">Click a row</span> to switch and open Overview; use the button if you prefer to stay on Settings. If the database enforces one row per email, add another unit with{" "}
                <span className="font-medium text-foreground">Add device…</span> (different email per serial), then pick which one to display here.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-2"
            disabled={regLoading || !meshUsername}
            onClick={() => void loadRegistrations()}
          >
            <RefreshCw className={`w-4 h-4 ${regLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {regError && (
          <div className="text-sm text-destructive border border-destructive/30 rounded-lg px-3 py-2 bg-destructive/5">
            {regError}
          </div>
        )}

        {regBanner && !regError && (
          <div className="text-sm text-amber-900 dark:text-amber-100 border border-amber-500/40 rounded-lg px-3 py-2 bg-amber-500/10">
            {regBanner}
          </div>
        )}

        {!meshUsername ? (
          <p className="text-sm text-muted-foreground">Sign in to see registrations tied to your account.</p>
        ) : regLoading && devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No device rows found for this login in the database yet. Complete registration or use{" "}
            <span className="font-medium text-foreground">Add device…</span> below.
          </p>
        ) : (
          <>
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Devices per contact email
              </div>
              {byEmail.length === 0 ? (
                <p className="text-sm text-muted-foreground">No email addresses on file for these rows.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {byEmail.map((row) => (
                      <Badge key={row.email} variant="secondary" className="font-normal gap-1.5 px-3 py-1">
                        <span className="truncate max-w-[220px]" title={row.email}>
                          {row.email}
                        </span>
                        <span className="tabular-nums font-semibold text-foreground">{row.deviceCount}</span>
                        <span className="text-muted-foreground">
                          {row.deviceCount === 1 ? "device" : "devices"}
                        </span>
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Counts are for your MeshCentral login only. With unique email enforced server-side, each email is usually
                    one device unless your database allows duplicates.
                  </p>
                </>
              )}
            </div>

            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[160px]">Device name</TableHead>
                    <TableHead className="hidden sm:table-cell">Serial</TableHead>
                    <TableHead className="hidden md:table-cell">Organization</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="hidden lg:table-cell">Cloud</TableHead>
                    <TableHead className="hidden md:table-cell">Updated</TableHead>
                    <TableHead className="w-[1%] whitespace-nowrap text-right">Dashboard</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {devices.map((d) => (
                    <TableRow
                      key={`${d.serialNumber}-${d.updatedAt ?? ""}`}
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={(e) => {
                        const el = e.target as HTMLElement;
                        if (el.closest("button")) return;
                        if (dashboardSerialActive === d.serialNumber.trim()) return;
                        applyDeviceToDashboard(d, { goToOverview: true });
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        if (dashboardSerialActive === d.serialNumber.trim()) return;
                        applyDeviceToDashboard(d, { goToOverview: true });
                      }}
                    >
                      <TableCell className="font-medium max-w-[220px] align-top">
                        <div className="truncate" title={d.deviceName}>
                          {d.deviceName}
                        </div>
                        <div
                          className="sm:hidden font-mono text-[11px] text-muted-foreground truncate mt-0.5"
                          title={d.serialNumber}
                        >
                          {d.serialNumber}
                        </div>
                      </TableCell>
                      <TableCell
                        className="hidden sm:table-cell font-mono text-xs max-w-[140px] truncate align-top"
                        title={d.serialNumber}
                      >
                        {d.serialNumber}
                      </TableCell>
                      <TableCell
                        className="hidden md:table-cell max-w-[140px] truncate text-muted-foreground align-top"
                        title={d.organizationName}
                      >
                        {d.organizationName}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate text-muted-foreground align-top" title={d.email ?? ""}>
                        {d.email ?? "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {d.cloudSync === 1 || d.cloudSync === true ? "On" : "Off"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground text-xs whitespace-nowrap">
                        {formatDt(d.updatedAt ?? null)}
                      </TableCell>
                      <TableCell className="text-right align-top py-3">
                        {dashboardSerialActive === d.serialNumber.trim() ? (
                          <Badge variant="outline" className="font-normal">
                            Active
                          </Badge>
                        ) : (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              applyDeviceToDashboard(d);
                            }}
                          >
                            Use on dashboard
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>

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

      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Cpu className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="font-semibold text-foreground">Register another device</div>
              <div className="text-sm text-muted-foreground mt-1">
                Register another serial in MySQL (usually a <span className="font-medium text-foreground">different email</span> per serial when email is unique). To only change what the UI shows, pick{" "}
                <span className="font-medium text-foreground">Use on dashboard</span> in the table above — including switching between units that share your login but use different contact emails.
              </div>
            </div>
          </div>
          <Button className="shrink-0" onClick={() => navigate("/register?additional=1")}>
            Add device…
          </Button>
        </div>
      </div>

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
          { icon: Webhook, title: "Webhook Integration", desc: "Configure HTTP webhooks for real-time event forwarding" },
          { icon: Shield, title: "MQTT Output", desc: "Send detection events to an MQTT broker" },
          { icon: FileDown, title: "CSV Export", desc: "Export detection data and analytics reports" },
          { icon: Users, title: "Role-Based Access", desc: "Manage user accounts and permission levels" },
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
