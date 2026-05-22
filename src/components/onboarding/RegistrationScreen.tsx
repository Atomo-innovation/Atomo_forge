import { useEffect, useRef, useState } from "react";
import {
  MapPin,
  Cpu,
  Server,
  ExternalLink,
  ChevronLeft,
} from "lucide-react";

function agentRunNeedsSudoPassword(stderr: string, error: string): boolean {
  const s = `${stderr}\n${error}`.toLowerCase();
  return (
    /sudo:.*password/.test(s) ||
    /a password is required/.test(s) ||
    /sorry, try again/.test(s) ||
    /authentication failure/.test(s) ||
    /terminal is required to read the password/.test(s)
  );
}
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
import { AuthShell } from "@/components/layout/AuthShell";
import { FormSection } from "@/components/layout/FormSection";
import { setDeviceProfile } from "@/services/deviceProfile";
import { useAuthUsername } from "@/contexts/AuthUsernameContext";
import { authApiUrl } from "@/services/authApiUrl";
import { readMeshLoginCredential } from "@/services/authSession";

interface RegistrationScreenProps {
  onSuccess: () => void;
  /**
   * Profile storage key: omit to use logged-in MeshCentral username from context (normal login/register routes).
   * Pass explicitly from onboarding (`null` = legacy device cache until login).
   */
  meshUsername?: string | null;
}

const RegistrationScreen = ({
  onSuccess,
  meshUsername: meshUsernameProp,
}: RegistrationScreenProps) => {
  const authUsername = useAuthUsername();
  const storageUser =
    meshUsernameProp !== undefined ? meshUsernameProp : authUsername;
  const loggedInMeshUser =
    typeof storageUser === "string" && storageUser.trim() !== ""
      ? storageUser.trim().toLowerCase()
      : null;

  const defaultMeshCentralBaseUrl = "https://65.2.142.160:4434";
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
  const [meshCentralUser, setMeshCentralUser] = useState(
    () => loggedInMeshUser ?? "",
  );
  const [meshCentralPassword, setMeshCentralPassword] = useState(() => {
    if (!loggedInMeshUser) return "";
    const c = readMeshLoginCredential();
    return c?.username === loggedInMeshUser ? c.password : "";
  });
  const [meshGroupName, setMeshGroupName] = useState("");
  const [meshLoading, setMeshLoading] = useState(false);
  const [meshError, setMeshError] = useState("");
  const [meshInstallCmd, setMeshInstallCmd] = useState("");
  const [meshUninstallCmd, setMeshUninstallCmd] = useState("");
  const [meshIdCreated, setMeshIdCreated] = useState("");
  const [meshRunLoading, setMeshRunLoading] = useState<
    "install" | "uninstall" | null
  >(null);
  const [meshRunOutput, setMeshRunOutput] = useState<string | null>(null);
  /** Sudo password for Run on auth server (Linux); not the MeshCentral login password. */
  const [meshRunSudoModal, setMeshRunSudoModal] = useState<
    "install" | "uninstall" | null
  >(null);
  const [meshRunSudoPassword, setMeshRunSudoPassword] = useState("");
  /** Step 1: MeshCentral login. Step 2: create group + install commands. */
  const [meshWizardPhase, setMeshWizardPhase] = useState<"login" | "devices">(
    () => (loggedInMeshUser ? "devices" : "login"),
  );
  /** When true, show Step 1 even though Forge login already established the MeshCentral user. */
  const [meshShowManualSignIn, setMeshShowManualSignIn] = useState(false);
  /** Device saved; finishing MeshCentral (install modal) before onSuccess. */
  const [pendingRegistrationComplete, setPendingRegistrationComplete] =
    useState(false);
  const meshSectionRef = useRef<HTMLDivElement>(null);
  /** Closing sudo modal to run install — do not treat as cancel/skip. */
  const meshModalClosingForRunRef = useRef(false);

  useEffect(() => {
    if (meshGroupName.trim()) return;
    const suggested = organizationName.trim() || deviceName.trim();
    if (suggested) setMeshGroupName(suggested);
  }, [organizationName, deviceName, meshGroupName]);

  /** Create MeshCentral device group; returns false if API failed. */
  const createMeshGroupByName = async (name: string): Promise<boolean> => {
    if (meshIdCreated.trim()) return true;
    const trimmed = name.trim();
    if (!trimmed) {
      setMeshError(
        "Enter a device group name (or organization / device name) for MeshCentral.",
      );
      return false;
    }
    const { u, p } = resolveMeshCredentials();
    if (
      meshStatus !== null &&
      !meshStatus.serverProvisionConfigured &&
      (!u || !p)
    ) {
      setMeshError(
        "Enter MeshCentral username and password (same login as the MeshCentral web UI).",
      );
      return false;
    }
    if (u && !p) {
      setMeshError(
        "Enter MeshCentral password, or clear the username to use server-only provisioning.",
      );
      return false;
    }
    if (!u && p) {
      setMeshError(
        "Enter MeshCentral username, or clear the password to use server-only provisioning.",
      );
      return false;
    }
    if (meshStatus !== null && !meshStatus.configured) {
      setMeshError(
        "MeshCentral is not configured on the server. Fix settings above or turn off Activate Cloud Sync.",
      );
      return false;
    }
    setMeshLoading(true);
    setMeshError("");
    try {
      const payload: {
        meshName: string;
        meshCentralUser?: string;
        meshCentralPassword?: string;
      } = { meshName: trimmed };
      if (u && p) {
        payload.meshCentralUser = u;
        payload.meshCentralPassword = p;
      }
      const r = await fetch(authApiUrl("/api/meshcentral/create-group"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        const base = j?.error || "Could not create device group";
        const diag = j?.diagnostics as
          | {
              hasProvisionPass?: boolean;
              hasControlUrl?: boolean;
              meshcentralConfigPath?: string | null;
            }
          | undefined;
        const extra =
          r.status === 503 && diag && !diag.hasProvisionPass
            ? " Add MESHCENTRAL_PROVISION_PASS (and MESHCENTRAL_PROVISION_USER) to ready_atomo-forge-suite/.env, then restart the auth server (the API on port 3003). See /api/meshcentral/debug for which files were found."
            : r.status === 503 && diag && !diag.hasControlUrl
              ? " Point MESHCENTRAL_CONFIG_PATH at meshcentral-data/config.json or symlink meshcentral-data next to ready_atomo-forge-suite. See /api/meshcentral/debug."
              : "";
        setMeshError(base + extra);
        return false;
      }
      setMeshInstallCmd(String(j.linuxInstall || ""));
      setMeshUninstallCmd(String(j.linuxUninstall || ""));
      setMeshIdCreated(String(j.meshid || ""));
      if (typeof j.meshName === "string" && j.meshName)
        setMeshGroupName(j.meshName);
      else setMeshGroupName(trimmed);
      setMeshWizardPhase("devices");
      return true;
    } catch {
      setMeshError("Network error. Is the API server running on port 3003?");
      return false;
    } finally {
      setMeshLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMeshError("");
    setLoading(true);
    try {
      if (!email.trim()) {
        setError("Email is required and must be unique in the database.");
        return;
      }

      const emailNorm = email.trim().toLowerCase();
      const meshForApi =
        typeof storageUser === "string" && storageUser.trim() !== ""
          ? storageUser.trim().toLowerCase()
          : undefined;

      const res = await fetch("/api/devices/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serialNumber: serialNumber.trim(),
          meshUsername: meshForApi,
          deviceName: deviceName.trim(),
          organizationName: organizationName.trim(),
          email: emailNorm,
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
      setDeviceProfile(storageUser ?? undefined, {
        serialNumber: serialNumber.trim(),
        deviceName: deviceName.trim(),
        organizationName: organizationName.trim(),
        email: emailNorm,
        phone: phone.trim() || undefined,
        location: location.trim() || undefined,
        cloudSync,
        registeredAt: Date.now(),
      });

      // Cloud sync: create Atomic Center group and install agent (no command UI).
      if (cloudSync && meshStatus?.configured) {
        setPendingRegistrationComplete(true);
        const groupName =
          meshGroupName.trim() || organizationName.trim() || deviceName.trim();
        if (!groupName) {
          setMeshError("Enter a group name in Atomic Center.");
          setPendingRegistrationComplete(false);
          return;
        }
        if (!meshIdCreated.trim()) {
          const meshOk = await createMeshGroupByName(groupName);
          if (!meshOk) {
            setPendingRegistrationComplete(false);
            return;
          }
        }

        setMeshRunSudoPassword("");
        setMeshRunSudoModal("install");
        return;
      }

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
        const r = await fetch(authApiUrl("/api/meshcentral/status"));
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
            j.provisionPasswordMatchesDb === undefined
              ? null
              : !!j.provisionPasswordMatchesDb,
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

  useEffect(() => {
    if (!loggedInMeshUser) return;
    setMeshCentralUser((prev) => (prev.trim() ? prev : loggedInMeshUser));
    const c = readMeshLoginCredential();
    if (c?.username === loggedInMeshUser && c.password) {
      setMeshCentralPassword((prev) => (prev ? prev : c.password));
    }
    setMeshWizardPhase("devices");
  }, [loggedInMeshUser]);

  const resolveMeshCredentials = () => {
    const u = (meshCentralUser.trim() || loggedInMeshUser || "").trim();
    const p = meshCentralPassword.trim();
    return { u, p };
  };

  const handleMeshContinueToDevices = () => {
    setMeshError("");
    const { u, p } = resolveMeshCredentials();
    if (
      meshStatus !== null &&
      !meshStatus.serverProvisionConfigured &&
      (!u || !p)
    ) {
      setMeshError(
        "Enter MeshCentral username and password (same as the web UI).",
      );
      return;
    }
    if (u && !p) {
      setMeshError(
        "Enter MeshCentral password, or clear the username to use server-only provisioning.",
      );
      return;
    }
    if (!u && p) {
      setMeshError(
        "Enter MeshCentral username, or clear the password to use server-only provisioning.",
      );
      return;
    }
    if (meshStatus !== null && !meshStatus.configured) {
      setMeshError(
        "MeshCentral server URLs are not available. Fix the configuration shown above first.",
      );
      return;
    }
    setMeshShowManualSignIn(false);
    setMeshWizardPhase("devices");
  };

  const finishRegistrationIfPending = () => {
    if (!pendingRegistrationComplete) return;
    setPendingRegistrationComplete(false);
    onSuccess();
  };

  const handleRunMeshAgent = async (
    action: "install" | "uninstall",
    sudoPassword?: string,
  ): Promise<{ ok: boolean; needsSudoPassword?: boolean }> => {
    if (!meshIdCreated.trim()) {
      setMeshError("Create a device group first so a Mesh ID is available.");
      return { ok: false };
    }
    setMeshRunLoading(action);
    setMeshError("");
    setMeshRunOutput(null);
    try {
      const { u, p } = resolveMeshCredentials();
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
      const r = await fetch(authApiUrl("/api/meshcentral/run-agent"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => null);
      const combined =
        [j?.stdout, j?.stderr].filter(Boolean).join("\n---\n").trim() || "";
      if (!r.ok || !j?.ok) {
        const errText =
          typeof j?.error === "string"
            ? j.error
            : j?.stderr ||
              "Agent install failed (check server logs).";
        setMeshError(errText);
        if (combined) setMeshRunOutput(combined);
        return {
          ok: false,
          needsSudoPassword: agentRunNeedsSudoPassword(combined, errText),
        };
      }
      setMeshRunOutput(combined || "Finished.");
      return { ok: true };
    } catch {
      setMeshError("Network error. Is the API server running on port 3003?");
      return { ok: false };
    } finally {
      setMeshRunLoading(null);
    }
  };

  const confirmRunMeshAgent = () => {
    if (!meshRunSudoModal || meshRunLoading !== null) return;
    const action = meshRunSudoModal;
    const pwd = meshRunSudoPassword.trim();
    if (!pwd) {
      setMeshError("Enter your Linux sudo password in the popup to continue.");
      return;
    }
    const finishAfterRun = pendingRegistrationComplete && action === "install";
    meshModalClosingForRunRef.current = true;
    setMeshRunSudoModal(null);
    setMeshRunSudoPassword("");
    void (async () => {
      const result = await handleRunMeshAgent(action, pwd);
      meshModalClosingForRunRef.current = false;
      if (finishAfterRun && result.ok) finishRegistrationIfPending();
      else if (finishAfterRun && result.needsSudoPassword) {
        setMeshError("Incorrect sudo password or insufficient permissions.");
        setMeshRunSudoModal("install");
      }
    })();
  };

  return (
    <AuthShell
      maxWidth="lg"
      title="Register your device"
      description="One device per account. Enter details, enable Cloud Sync, configure Atomic Center, then register."
      icon={<Cpu className="h-6 w-6" />}
    >
      <form onSubmit={handleRegister} className="space-y-8">
        <FormSection
          title="Device registration"
          description="Identity and contact details for this processing unit."
          icon={<Cpu className="h-5 w-5" />}
        >
          <div className="space-y-5">
            {error && (
              <div className="px-4 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                {error}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-secondary-foreground mb-2">
                Device Serial Number
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="APU-XXXX-XXXX-XXXX"
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.target.value)}
                  className="flex-1 px-4 py-3 rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all font-mono text-sm"
                />
                <button
                  type="button"
                  className="px-4 py-3 rounded-lg border border-border text-sm text-muted-foreground hover:bg-secondary transition-colors"
                >
                  Auto-detect
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-secondary-foreground mb-2">
                Device Name
              </label>
              <input
                type="text"
                placeholder="e.g., Factory Floor Unit 1"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-secondary-foreground mb-2">
                Organization Name
              </label>
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
                <label className="block text-sm font-medium text-secondary-foreground mb-2">
                  Email <span className="text-destructive">*</span>
                </label>
                <input
                  type="email"
                  required
                  placeholder="admin@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Must be unique — one device per email.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-secondary-foreground mb-2">
                  Phone
                </label>
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
                <MapPin className="w-3.5 h-3.5 inline mr-1" />
                Location{" "}
                <span className="text-muted-foreground">(Optional)</span>
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
                <p className="text-xs text-muted-foreground">
                  Enable remote monitoring and analytics
                </p>
              </div>
            </label>
          </div>
        </FormSection>

        <FormSection
          title="Atomic Center"
          description="Remote management and agent installation via MeshCentral."
          icon={<Server className="h-5 w-5" />}
        >
          <div ref={meshSectionRef} aria-labelledby="meshcentral-heading" className="space-y-4">

            {meshStatus === null && (
              <p className="text-xs text-muted-foreground">
                Checking MeshCentral API…
              </p>
            )}
            {meshStatus && !meshStatus.configured && (
              <div className="px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-200/90 whitespace-pre-wrap">
                {meshStatus.provisionHint ||
                  (meshStatus.needsCredentials
                    ? "Set MESHCENTRAL_PROVISION_USER and MESHCENTRAL_PROVISION_PASS in ready_atomo-forge-suite/.env (copy from .env.example). Use the same login as the MeshCentral browser UI — not MYSQL_PASSWORD. Or use meshcentral-data/atomo-provision.json."
                    : "Set MESHCENTRAL_CONTROL_URL and MESHCENTRAL_AGENT_BASE_URL, or place meshcentral-data/config.json where the auth server can find it.")}
              </div>
            )}

            {meshWizardPhase === "login" &&
              (!loggedInMeshUser || meshShowManualSignIn) && (
                <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4 md:p-5">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">
                      Step 1 — MeshCentral sign-in
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      Use the same username and password as the MeshCentral web
                      UI.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-secondary-foreground mb-2">
                        Username
                        {meshStatus !== null &&
                        meshStatus.serverProvisionConfigured ? (
                          <span className="text-muted-foreground font-normal">
                            {" "}
                            (optional)
                          </span>
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
                        {meshStatus !== null &&
                        meshStatus.serverProvisionConfigured ? (
                          <span className="text-muted-foreground font-normal">
                            {" "}
                            (optional)
                          </span>
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
                    Credentials are sent only to your auth API to create groups;
                    use HTTPS in production.
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
                            setMeshError(
                              "MeshCentral server URLs are not available yet.",
                            );
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
                {!loggedInMeshUser && (
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
                )}

                <div className="rounded-xl border border-border bg-muted/20 p-4 md:p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                      1
                    </span>
                    <div className="min-w-0 flex-1 space-y-3">
                      <div>
                        <h4 className="text-sm font-semibold">
                          Add device group
                        </h4>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Group name used when you register with Cloud Sync on.
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-secondary-foreground mb-2">
                          Group name
                        </label>
                        <input
                          type="text"
                          placeholder={
                            organizationName.trim() ||
                            deviceName.trim() ||
                            "e.g. Production floor"
                          }
                          value={meshGroupName}
                          onChange={(e) => setMeshGroupName(e.target.value)}
                          className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                        />
                      </div>
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
        </FormSection>

        <div className="pt-2">
              <button
                type="submit"
                disabled={
                  loading ||
                  (meshLoading && pendingRegistrationComplete) ||
                  meshRunLoading !== null
                }
                className="btn-primary-gradient w-full py-3.5"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Registering...
                  </span>
                ) : meshRunLoading === "install" && pendingRegistrationComplete ? (
                  "Installing agent…"
                ) : meshLoading && pendingRegistrationComplete ? (
                  "Creating group…"
                ) : (
                  "Register Device"
                )}
              </button>
        </div>
      </form>

      <Dialog
        open={meshRunSudoModal !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMeshRunSudoModal(null);
            setMeshRunSudoPassword("");
            if (!meshModalClosingForRunRef.current) {
              finishRegistrationIfPending();
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Install agent on server</DialogTitle>
            <DialogDescription className="text-left pt-1">
              Enter the Linux <strong>sudo password</strong> for the server that
              runs this app. It is used only to install the agent — not shown in
              the terminal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <label
              htmlFor="mesh-run-sudo-password"
              className="text-sm font-medium"
            >
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
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                meshModalClosingForRunRef.current = false;
                setMeshRunSudoModal(null);
                finishRegistrationIfPending();
              }}
            >
              {pendingRegistrationComplete ? "Skip agent install" : "Cancel"}
            </Button>
            <Button
              type="button"
              onClick={confirmRunMeshAgent}
              disabled={meshRunLoading !== null}
            >
              {meshRunLoading !== null ? "Installing…" : "Install agent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AuthShell>
  );
};

export default RegistrationScreen;
