import { useState, useEffect, useMemo } from "react";
import { Cpu } from "lucide-react";
import { authApiUrl } from "@/services/authApiUrl";
import { persistMeshLoginCredential } from "@/services/authSession";

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
  /** MeshCentral web UI URL (Create account link uses this). */
  const defaultMeshCentralBaseUrl = "https://65.2.142.160:4434";

  const [meshCentralUrlFromApi, setMeshCentralUrlFromApi] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/meshcentral/status");
        const j = await r.json().catch(() => null);
        if (cancelled || !j?.ok) return;
        // Use MeshCentral "control" URL (web UI) for links like create-account/login.
        const raw = j?.controlUrl || j?.agentBaseUrl;
        if (!raw) return;
        const s = String(raw).trim();
        // Backend controlUrl is often "wss://host:port/control.ashx" — convert to "https://host:port".
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
              `Update MYSQL_HOST/MYSQL_PORT in .env and restart the dev server.`
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
    <div className="flex items-center justify-center min-h-screen px-6 py-12">
      <div className="w-full max-w-md opacity-0 animate-scale-in">
        <div className="glass rounded-2xl p-8 md:p-10">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-atomic flex items-center justify-center">
              <Cpu className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">Login</h2>
              <p className="text-sm text-muted-foreground">Enter your credentials to continue</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="px-4 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                {error}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-secondary-foreground mb-2">Username</label>
              <input
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-secondary-foreground mb-2">Password</label>
              <input
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full px-6 py-3.5 rounded-lg bg-gradient-atomic font-semibold text-primary-foreground glow-primary-sm transition-all duration-300 hover:scale-[1.02] disabled:opacity-60 disabled:hover:scale-100"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Logging in...
                </span>
              ) : (
                "Login"
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <a
              href={createAccountHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-primary hover:underline inline-block"
            >
              Create account
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginScreen;
