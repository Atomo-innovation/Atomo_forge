import { useEffect, useState } from "react";
import { MapPin, Cpu, Server, Copy, ExternalLink, ChevronLeft, Play, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setDeviceProfile } from "@/services/deviceProfile";

interface RegistrationScreenProps {
  onSuccess: () => void;
}

const RegistrationScreen = ({ onSuccess }: RegistrationScreenProps) => {
  const defaultMeshCentralBaseUrl = "https://192.168.1.30:4434";
  const [serialNumber, setSerialNumber] = useState("APU-2026-E7K3-9F1A");
  const [deviceName, setDeviceName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [cloudSync, setCloudSync] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [meshStatus, setMeshStatus] = useState<{
    configured: boolean;
    serverProvisionConfigured?: boolean;
    agentBaseUrl: string | null;
    controlUrl?: string | null;
    needsCredentials: boolean;
    provisionHint?: string | null;
    provisionDbError?: string | null;
    provisionPasswordMatchesDb?: boolean | null;
  } | null>(null);
  const [meshCentralUser, setMeshCentralUser] = useState("");
  const [meshCentralPassword, setMeshCentralPassword] = useState("");
  const [meshGroupName, setMeshGroupName] = useState("");
  const [meshLoading, setMeshLoading] = useState(false);
  const [meshError, setMeshError] = useState("");
  const [meshInstallCmd, setMeshInstallCmd] = useState("");
  const [meshUninstallCmd, setMeshUninstallCmd] = useState("");
  const [meshIdCreated, setMeshIdCreated] = useState("");
  const [meshCopyFlash, setMeshCopyFlash] = useState<"install" | "uninstall" | null>(null);
  const [meshRunLoading, setMeshRunLoading] = useState<"install" | "uninstall" | null>(null);
  const [meshRunOutput, setMeshRunOutput] = useState<string | null>(null);
  /** Sudo password for Run on auth server (Linux); not the MeshCentral login password. */
  const [meshRunSudoModal, setMeshRunSudoModal] = useState<"install" | "uninstall" | null>(null);
  const [meshRunSudoPassword, setMeshRunSudoPassword] = useState("");
  const [meshDeleteLoading, setMeshDeleteLoading] = useState(false);
  /** Step 1: MeshCentral login. Step 2: create group + install commands. */
  const [meshWizardPhase, setMeshWizardPhase] = useState<"login" | "devices">("login");

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/devices/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serialNumber: serialNumber.trim(),
          deviceName: deviceName.trim(),
          organizationName: organizationName.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          location: location.trim() || undefined,
          cloudSync,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Device registration failed");
        return;
      }
      // Cache the registered device details locally so the dashboard top bar
      // can display them and Login knows registration is already complete.
      setDeviceProfile({
        serialNumber: serialNumber.trim(),
        deviceName: deviceName.trim(),
        organizationName: organizationName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        location: location.trim() || undefined,
        cloudSync,
        registeredAt: Date.now(),
      });
      onSuccess();
    } catch {
      setError("Network error. Is the API server running on port 3003?");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/meshcentral/status");
        const j = await r.json().catch(() => null);
        if (cancelled) return;
        if (!j?.ok) {
          setMeshStatus({
            configured: false,
            serverProvisionConfigured: false,
            agentBaseUrl: null,
            controlUrl: null,
            needsCredentials: true,
            provisionDbError: null,
            provisionPasswordMatchesDb: null,
          });
          return;
        }
        setMeshStatus({
          configured: !!j.configured,
          serverProvisionConfigured: !!j.serverProvisionConfigured,
          agentBaseUrl: j.agentBaseUrl ?? null,
          controlUrl: j.controlUrl ?? null,
          needsCredentials: !!j.needsCredentials,
          provisionHint: j.provisionHint ?? null,
          provisionDbError: j.provisionDbError ?? null,
          provisionPasswordMatchesDb:
            j.provisionPasswordMatchesDb === undefined ? null : !!j.provisionPasswordMatchesDb,
        });
      } catch {
        if (!cancelled) {
          setMeshStatus({
            configured: false,
            serverProvisionConfigured: false,
            agentBaseUrl: null,
            controlUrl: null,
            needsCredentials: true,
            provisionHint: null,
            provisionDbError: null,
            provisionPasswordMatchesDb: null,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleMeshContinueToDevices = () => {
    setMeshError("");
    const u = meshCentralUser.trim();
    const p = meshCentralPassword;
    if (meshStatus !== null && !meshStatus.serverProvisionConfigured && (!u || !p)) {
      setMeshError("Enter MeshCentral username and password (same as the web UI).");
      return;
    }
    if (u && !p) {
      setMeshError("Enter MeshCentral password, or clear the username to use server-only provisioning.");
      return;
    }
    if (!u && p) {
      setMeshError("Enter MeshCentral username, or clear the password to use server-only provisioning.");
      return;
    }
    if (meshStatus !== null && !meshStatus.configured) {
      setMeshError("MeshCentral server URLs are not available. Fix the configuration shown above first.");
      return;
    }
    setMeshWizardPhase("devices");
  };

  const handleCreateMeshGroup = async () => {
    if (meshLoading) return;
    setMeshError("");
    const name = meshGroupName.trim();
    if (!name) {
      setMeshError("Enter a device group name");
      return;
    }
    const u = meshCentralUser.trim();
    const p = meshCentralPassword;
    if (meshStatus !== null && !meshStatus.serverProvisionConfigured && (!u || !p)) {
      setMeshError("Enter MeshCentral username and password (same login as the MeshCentral web UI).");
      return;
    }
    if (u && !p) {
      setMeshError("Enter MeshCentral password, or clear the username to use server-only provisioning.");
      return;
    }
    if (!u && p) {
      setMeshError("Enter MeshCentral username, or clear the password to use server-only provisioning.");
      return;
    }
    setMeshLoading(true);
    try {
      const payload: {
        meshName: string;
        meshCentralUser?: string;
        meshCentralPassword?: string;
      } = { meshName: name };
      if (u && p) {
        payload.meshCentralUser = u;
        payload.meshCentralPassword = p;
      }
      const r = await fetch("/api/meshcentral/create-group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        const base = j?.error || "Could not create device group";
        const diag = j?.diagnostics as
          | { hasProvisionPass?: boolean; hasControlUrl?: boolean; meshcentralConfigPath?: string | null }
          | undefined;
        const extra =
          r.status === 503 && diag && !diag.hasProvisionPass
            ? " Add MESHCENTRAL_PROVISION_PASS (and MESHCENTRAL_PROVISION_USER) to ready_atomo-forge-suite/.env, then restart the auth server (the API on port 3003). See /api/meshcentral/debug for which files were found."
            : r.status === 503 && diag && !diag.hasControlUrl
              ? " Point MESHCENTRAL_CONFIG_PATH at meshcentral-data/config.json or symlink meshcentral-data next to ready_atomo-forge-suite. See /api/meshcentral/debug."
              : "";
        setMeshError(base + extra);
        return;
      }
      setMeshInstallCmd(String(j.linuxInstall || ""));
      setMeshUninstallCmd(String(j.linuxUninstall || ""));
      setMeshIdCreated(String(j.meshid || ""));
      if (typeof j.meshName === "string" && j.meshName) setMeshGroupName(j.meshName);
    } catch {
      setMeshError("Network error. Is the API server running on port 3003?");
    } finally {
      setMeshLoading(false);
    }
  };

  const handleDeleteCurrentMeshGroup = async () => {
    if (!meshIdCreated.trim() || meshDeleteLoading || meshLoading) return;
    const displayName = meshGroupName.trim() || meshIdCreated;
    if (
      !window.confirm(
        `Delete MeshCentral device group "${displayName}"?\n\nThis removes the group and all devices in it. You must be a full administrator on that group (same as the MeshCentral web UI). This cannot be undone.`,
      )
    )
      return;
    setMeshDeleteLoading(true);
    setMeshError("");
    try {
      const u = meshCentralUser.trim();
      const p = meshCentralPassword;
      const payload: {
        meshid: string;
        meshName: string;
        meshCentralUser?: string;
        meshCentralPassword?: string;
      } = {
        meshid: meshIdCreated,
        meshName: meshGroupName.trim() || displayName,
      };
      if (u && p) {
        payload.meshCentralUser = u;
        payload.meshCentralPassword = p;
      }
      const r = await fetch("/api/meshcentral/delete-group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setMeshError(typeof j?.error === "string" ? j.error : "Could not delete group");
        return;
      }
      setMeshIdCreated("");
      setMeshInstallCmd("");
      setMeshUninstallCmd("");
      setMeshRunOutput(null);
    } catch {
      setMeshError("Network error. Is the API server running on port 3003?");
    } finally {
      setMeshDeleteLoading(false);
    }
  };

  const copyMeshLine = async (which: "install" | "uninstall") => {
    const text = which === "install" ? meshInstallCmd : meshUninstallCmd;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setMeshCopyFlash(which);
      window.setTimeout(() => setMeshCopyFlash(null), 2000);
    } catch {
      setMeshError("Could not copy to clipboard");
    }
  };

  const handleRunMeshAgent = async (action: "install" | "uninstall", sudoPassword?: string) => {
    if (!meshIdCreated.trim()) {
      setMeshError("Create a device group first so a Mesh ID is available.");
      return;
    }
    setMeshRunLoading(action);
    setMeshError("");
    setMeshRunOutput(null);
    try {
      const u = meshCentralUser.trim();
      const p = meshCentralPassword;
      const payload: {
        meshid: string;
        action: "install" | "uninstall";
        meshCentralUser?: string;
        meshCentralPassword?: string;
        sudoPassword?: string;
      } = { meshid: meshIdCreated, action };
      if (u && p) {
        payload.meshCentralUser = u;
        payload.meshCentralPassword = p;
      }
      if (sudoPassword != null && sudoPassword !== "") {
        payload.sudoPassword = sudoPassword;
      }
      const r = await fetch("/api/meshcentral/run-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => null);
      const combined =
        [j?.stdout, j?.stderr].filter(Boolean).join("\n---\n").trim() || "";
      if (!r.ok || !j?.ok) {
        setMeshError(
          typeof j?.error === "string" ? j.error : j?.stderr || "Run failed (check server logs / meshcentral API response)",
        );
        if (combined) setMeshRunOutput(combined);
        return;
      }
      setMeshRunOutput(combined || "Finished.");
    } catch {
      setMeshError("Network error. Is the API server running on port 3003?");
    } finally {
      setMeshRunLoading(null);
    }
  };

  const openRunSudoModal = (action: "install" | "uninstall") => {
    if (!meshIdCreated.trim()) {
      setMeshError("Create a device group first so a Mesh ID is available.");
      return;
    }
    setMeshRunSudoPassword("");
    setMeshRunSudoModal(action);
  };

  const confirmRunMeshAgent = () => {
    if (!meshRunSudoModal || meshRunLoading !== null) return;
    const action = meshRunSudoModal;
    const pwd = meshRunSudoPassword;
    setMeshRunSudoModal(null);
    setMeshRunSudoPassword("");
    void handleRunMeshAgent(action, pwd);
  };

  return (
    <div className="flex items-center justify-center min-h-screen px-6 py-12">
      <div className="w-full max-w-lg opacity-0 animate-scale-in">
        <div className="glass rounded-2xl p-8 md:p-10">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-atomic flex items-center justify-center">
              <Cpu className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">Register Your Device</h2>
              <p className="text-sm text-muted-foreground">Connect your Atomo Processing Unit</p>
            </div>
          </div>

          <form onSubmit={handleRegister} className="space-y-5">
            {error && (
              <div className="px-4 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                {error}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-secondary-foreground mb-2">Device Serial Number</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="APU-XXXX-XXXX-XXXX"
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.target.value)}
                  className="flex-1 px-4 py-3 rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all font-mono text-sm"
                />
                <button type="button" className="px-4 py-3 rounded-lg border border-border text-sm text-muted-foreground hover:bg-secondary transition-colors">
                  Auto-detect
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-secondary-foreground mb-2">Device Name</label>
              <input
                type="text"
                placeholder="e.g., Factory Floor Unit 1"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-secondary-foreground mb-2">Organization Name</label>
              <input
                type="text"
                placeholder="Your company or team name"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-secondary-foreground mb-2">Email</label>
                <input
                  type="email"
                  placeholder="admin@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-secondary-foreground mb-2">Phone</label>
                <input
                  type="tel"
                  placeholder="+91 XXXXX XXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-secondary-foreground mb-2">
                <MapPin className="w-3.5 h-3.5 inline mr-1" />Location <span className="text-muted-foreground">(Optional)</span>
              </label>
              <input
                type="text"
                placeholder="City, State"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              />
            </div>

            <label className="flex items-center gap-3 p-4 rounded-lg bg-muted/50 border border-border cursor-pointer hover:bg-muted transition-colors">
              <input
                type="checkbox"
                checked={cloudSync}
                onChange={(e) => setCloudSync(e.target.checked)}
                className="w-4 h-4 rounded accent-primary"
              />
              <div>
                <span className="text-sm font-medium">Activate Cloud Sync</span>
                <p className="text-xs text-muted-foreground">Enable remote monitoring and analytics</p>
              </div>
            </label>

            <div className="pt-2 space-y-3">
              <button
                type="submit"
                disabled={loading}
                className="w-full px-6 py-3.5 rounded-lg bg-gradient-atomic font-semibold text-primary-foreground glow-primary-sm transition-all duration-300 hover:scale-[1.02] disabled:opacity-60 disabled:hover:scale-100"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Registering...
                  </span>
                ) : (
                  "Register Device"
                )}
              </button>
            </div>
          </form>

          <div className="mt-8 pt-8 border-t border-border space-y-4">
            <div className="flex items-center gap-2">
              <Server className="w-5 h-5 text-muted-foreground" />
              <h3 className="text-lg font-semibold">MeshCentral</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Connect with your MeshCentral account, then create a device group. Run executes the install/uninstall on the machine that hosts the auth API (Linux). Copy-paste is for other machines.
            </p>

            {meshStatus === null && (
              <p className="text-xs text-muted-foreground">Checking MeshCentral API…</p>
            )}
            {meshStatus && !meshStatus.configured && (
              <div className="px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-200/90 whitespace-pre-wrap">
                {meshStatus.provisionHint ||
                  (meshStatus.needsCredentials
                    ? "Set MESHCENTRAL_PROVISION_USER and MESHCENTRAL_PROVISION_PASS in ready_atomo-forge-suite/.env (copy from .env.example). Use the same login as the MeshCentral browser UI — not MYSQL_PASSWORD. Or use meshcentral-data/atomo-provision.json."
                    : "Set MESHCENTRAL_CONTROL_URL and MESHCENTRAL_AGENT_BASE_URL, or place meshcentral-data/config.json where the auth server can find it.")}
              </div>
            )}
            {meshStatus?.configured && meshStatus.agentBaseUrl && (
              <p className="text-xs text-muted-foreground font-mono break-all">
                Server: {meshStatus.agentBaseUrl}
              </p>
            )}

            {meshWizardPhase === "login" && (
              <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4 md:p-5">
                <div>
                  <h4 className="text-sm font-semibold text-foreground">Step 1 — MeshCentral sign-in</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Use the same username and password as the MeshCentral web UI.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-secondary-foreground mb-2">
                      Username
                      {meshStatus !== null && meshStatus.serverProvisionConfigured ? (
                        <span className="text-muted-foreground font-normal"> (optional)</span>
                      ) : (
                        <span className="text-destructive"> *</span>
                      )}
                    </label>
                    <input
                      type="text"
                      autoComplete="username"
                      placeholder="e.g. atomo"
                      value={meshCentralUser}
                      onChange={(e) => setMeshCentralUser(e.target.value)}
                      className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-secondary-foreground mb-2">
                      Password
                      {meshStatus !== null && meshStatus.serverProvisionConfigured ? (
                        <span className="text-muted-foreground font-normal"> (optional)</span>
                      ) : (
                        <span className="text-destructive"> *</span>
                      )}
                    </label>
                    <input
                      type="password"
                      autoComplete="current-password"
                      placeholder="MeshCentral web login"
                      value={meshCentralPassword}
                      onChange={(e) => setMeshCentralPassword(e.target.value)}
                      className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Credentials are sent only to your auth API to create groups; use HTTPS in production.
                </p>
                {meshError && (
                  <div className="px-4 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                    {meshError}
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleMeshContinueToDevices}
                    className="w-full px-6 py-3 rounded-lg bg-gradient-atomic font-semibold text-primary-foreground glow-primary-sm transition-all duration-300 hover:scale-[1.01]"
                  >
                    Continue to add group &amp; devices
                  </button>
                  {meshStatus?.serverProvisionConfigured && (
                    <button
                      type="button"
                      onClick={() => {
                        setMeshError("");
                        if (meshStatus && !meshStatus.configured) {
                          setMeshError("MeshCentral server URLs are not available yet.");
                          return;
                        }
                        setMeshWizardPhase("devices");
                      }}
                      className="w-full px-4 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-secondary transition-colors"
                    >
                      Skip sign-in — use server provisioning
                    </button>
                  )}
                </div>
              </div>
            )}

            {meshWizardPhase === "devices" && (
              <div className="space-y-5">
                <button
                  type="button"
                  onClick={() => {
                    setMeshError("");
                    setMeshWizardPhase("login");
                  }}
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Change sign-in
                </button>

                <div className="rounded-xl border border-border bg-muted/20 p-4 md:p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                      1
                    </span>
                    <div className="min-w-0 flex-1 space-y-3">
                      <div>
                        <h4 className="text-sm font-semibold">Add device group</h4>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Enter a name and create a group on MeshCentral. Then use Run below to execute the install on the auth server (Linux), or copy the command for other machines.
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-secondary-foreground mb-2">Group name</label>
                        <input
                          type="text"
                          placeholder={organizationName.trim() || deviceName.trim() || "e.g. Production floor"}
                          value={meshGroupName}
                          onChange={(e) => setMeshGroupName(e.target.value)}
                          className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={meshLoading}
                        onClick={handleCreateMeshGroup}
                        className="w-full px-6 py-3 rounded-lg border border-border font-semibold text-foreground hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {meshLoading ? (
                          <span className="flex items-center justify-center gap-2">
                            <span className="w-4 h-4 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin" />
                            Creating group…
                          </span>
                        ) : (
                          "Create device group"
                        )}
                      </button>
                      {meshIdCreated && (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground font-mono break-all">Mesh ID: {meshIdCreated}</p>
                          <button
                            type="button"
                            onClick={() => void handleDeleteCurrentMeshGroup()}
                            disabled={meshDeleteLoading || meshLoading}
                            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-sm font-medium hover:bg-destructive/20 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {meshDeleteLoading ? (
                              <span className="flex items-center gap-2">
                                <span className="w-4 h-4 border-2 border-destructive/30 border-t-destructive rounded-full animate-spin" />
                                Deleting…
                              </span>
                            ) : (
                              <>
                                <Trash2 className="w-4 h-4" />
                                Delete this device group
                              </>
                            )}
                          </button>
                          <p className="text-xs text-muted-foreground">
                            Requires full admin rights on the group. If delete fails with “Access denied”, use MeshCentral → group → users and ensure your account is administrator.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-muted/20 p-4 md:p-5 space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                      2
                    </span>
                    <div className="min-w-0 flex-1 space-y-3">
                      <div>
                        <h4 className="text-sm font-semibold">Add devices (Linux)</h4>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Run opens a prompt for your Linux <strong>sudo</strong> password (for the server user), then runs the same command on the auth server. For other PCs, copy the command and run it there (or use SSH).
                        </p>
                      </div>
                      {!meshInstallCmd && (
                        <p className="text-xs text-amber-200/90 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">
                          Create a device group in step 1 to generate install and uninstall commands here.
                        </p>
                      )}
                      {meshInstallCmd && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-sm font-medium text-secondary-foreground">Install</span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={meshRunLoading !== null}
                                onClick={() => openRunSudoModal("install")}
                                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-primary/50 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                              >
                                <Play className="w-3.5 h-3.5" />
                                {meshRunLoading === "install" ? "Running…" : "Run"}
                              </button>
                              <button
                                type="button"
                                onClick={() => copyMeshLine("install")}
                                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:bg-secondary"
                              >
                                <Copy className="w-3.5 h-3.5" />
                                {meshCopyFlash === "install" ? "Copied" : "Copy"}
                              </button>
                            </div>
                          </div>
                          <pre className="text-xs p-3 rounded-lg bg-muted/80 border border-border overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                            {meshInstallCmd}
                          </pre>
                        </div>
                      )}
                      {meshUninstallCmd && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-sm font-medium text-secondary-foreground">Uninstall</span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={meshRunLoading !== null}
                                onClick={() => openRunSudoModal("uninstall")}
                                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-50"
                              >
                                <Play className="w-3.5 h-3.5" />
                                {meshRunLoading === "uninstall" ? "Running…" : "Run"}
                              </button>
                              <button
                                type="button"
                                onClick={() => copyMeshLine("uninstall")}
                                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:bg-secondary"
                              >
                                <Copy className="w-3.5 h-3.5" />
                                {meshCopyFlash === "uninstall" ? "Copied" : "Copy"}
                              </button>
                            </div>
                          </div>
                          <pre className="text-xs p-3 rounded-lg bg-muted/80 border border-border overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                            {meshUninstallCmd}
                          </pre>
                        </div>
                      )}
                      {meshRunOutput && (
                        <div className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground">Last run output</span>
                          <pre className="text-xs p-3 rounded-lg bg-background/50 border border-border overflow-x-auto whitespace-pre-wrap break-all max-h-36 overflow-y-auto">
                            {meshRunOutput}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {meshError && (
                  <div className="px-4 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                    {meshError}
                  </div>
                )}

            {(meshStatus?.controlUrl || meshStatus?.agentBaseUrl) && (
                  <a
                href={defaultMeshCentralBaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Open MeshCentral dashboard
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </div>


      <Dialog
        open={meshRunSudoModal !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMeshRunSudoModal(null);
            setMeshRunSudoPassword("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {meshRunSudoModal === "uninstall" ? "Run uninstall on this server" : "Run install on this server"}
            </DialogTitle>
            <DialogDescription className="text-left space-y-2 pt-1">
              <span className="block">
                The script runs on the Linux machine that hosts this app and uses <code className="text-xs bg-muted px-1 rounded">sudo</code>. Enter
                the password for your <strong>Linux user account</strong> on that server (this is not your MeshCentral web password).
              </span>
              <span className="block text-muted-foreground">
                Leave the field empty only if sudo is passwordless (NOPASSWD) for this user.
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <label htmlFor="mesh-run-sudo-password" className="text-sm font-medium">
              Sudo / Linux password
            </label>
            <Input
              id="mesh-run-sudo-password"
              type="password"
              autoComplete="off"
              placeholder="••••••••"
              value={meshRunSudoPassword}
              onChange={(e) => setMeshRunSudoPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmRunMeshAgent();
                }
              }}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setMeshRunSudoModal(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={confirmRunMeshAgent} disabled={meshRunLoading !== null}>
              {meshRunLoading !== null ? "Running…" : "Run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RegistrationScreen;
