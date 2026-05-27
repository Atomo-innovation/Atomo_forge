import { useState, useEffect, useMemo } from "react";
import { Cpu } from "lucide-react";
import { authApiUrl } from "@/services/authApiUrl";
import { persistMeshLoginCredential } from "@/services/authSession";
import { AuthShell } from "@/components/layout/AuthShell";

interface LoginScreenProps {
  onGetStarted: () => void;
  /** Called with normalized MeshCentral username after successful login. */
  onLoginSuccess?: (meshUsername: string) => void;
}

type ApiErrorPayload = {
  ok?: boolean;
  error?: string;
  dbTarget?: { host?: string; port?: number; database?: string; user?: string };
  details?: { code?: string | null; address?: string | null; port?: number | null };
};

const LoginScreen = ({ onGetStarted, onLoginSuccess }: LoginScreenProps) => {
  const defaultMeshCentralBaseUrl = "https://65.2.142.160:4434";

  const [meshCentralUrlFromApi, setMeshCentralUrlFromApi] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/meshcentral/status");
        const j = await r.json().catch(() => null);
        if (cancelled || !j?.ok) return;
        const raw = j?.controlUrl || j?.agentBaseUrl;
        if (!raw) return;
        const s = String(raw).trim();
        try {
          const u = new URL(s);
          const proto =
            u.protocol === "wss:" ? "https:" : u.protocol === "ws:" ? "http:" : u.protocol;
          setMeshCentralUrlFromApi(`${proto}//${u.host}`.replace(/\/$/, ""));
        } catch {
          setMeshCentralUrlFromApi(s.replace(/\/$/, ""));
        }
      } catch {
        if (!cancelled) setMeshCentralUrlFromApi(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const meshCentralBaseUrl = useMemo(() => {
    return meshCentralUrlFromApi || defaultMeshCentralBaseUrl;
  }, [meshCentralUrlFromApi]);

  const createAccountHref = useMemo(() => {
    const base = meshCentralBaseUrl.replace(/\/$/, "");
    if (typeof window === "undefined") return `${base}/login?createaccount=1`;
    const atomoReturnUrl = window.location.href;
    return `${base}/login?createaccount=1&return=${encodeURIComponent(atomoReturnUrl)}`;
  }, [meshCentralBaseUrl]);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(authApiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data: ApiErrorPayload = await res.json().catch(() => ({}));
      if (!data.ok) {
        if (res.status === 503 && data?.dbTarget) {
          const host = data.dbTarget.host || "unknown-host";
          const port = data.dbTarget.port ?? "unknown-port";
          setError(
            `Login unavailable: database is not reachable (${host}:${port}). ` +
              `Update MYSQL_HOST/MYSQL_PORT in .env and restart the dev server.`,
          );
        } else {
          setError(data.error || "Login failed");
        }
        setLoading(false);
        return;
      }
      const normalizedUser = username.trim().toLowerCase();
      if (!normalizedUser) {
        setError("Enter a username");
        setLoading(false);
        return;
      }
      persistMeshLoginCredential(normalizedUser, password);
      if (onLoginSuccess) onLoginSuccess(normalizedUser);
      else onGetStarted();
    } catch {
      setError("Network error. Is the API server running on port 3003?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Sign in"
      description="Use your Atomic Center credentials to access the dashboard."
      icon={<Cpu className="h-6 w-6" />}
      forceLight
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Username</label>
          <input
            type="text"
            placeholder="Enter your username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="input-field"
            required
            autoComplete="username"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Password</label>
          <input
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-field"
            required
            autoComplete="current-password"
          />
        </div>
        <button type="submit" disabled={loading} className="btn-primary-gradient w-full py-3">
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
              Signing in…
            </span>
          ) : (
            "Sign in"
          )}
        </button>
        <p className="pt-1 text-center text-sm text-muted-foreground">
          <a
            href={createAccountHref}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary hover:underline"
          >
            Create account
          </a>
        </p>
      </form>
    </AuthShell>
  );
};

export default LoginScreen;
