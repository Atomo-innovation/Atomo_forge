/** WebSocket URLs for Universal inference attach (same host + optional env fallback). */

export function getUniversalWebSocketCandidates(): string[] {
  const wsCandidates: string[] = [];
  {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    wsCandidates.push(`${proto}://${window.location.host}/universal`);
  }
  {
    const envBase = (import.meta as any).env?.VITE_UNIVERSAL_MODEL_DASHBOARD_URL as string | undefined;
    if (envBase && typeof envBase === "string") {
      try {
        const u = new URL(envBase);
        u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
        u.pathname = "/";
        u.search = "";
        u.hash = "";
        wsCandidates.push(u.toString().replace(/\/$/, ""));
      } catch {
        // ignore invalid URL
      }
    }
  }
  return wsCandidates;
}
