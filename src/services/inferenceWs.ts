import type { InferenceBackendId } from "@/lib/inferenceBackend";

/** WebSocket URLs for inference attach (asnn-dashboard backend). */
export function getInferenceWebSocketCandidates(_backend: InferenceBackendId = "asnn"): string[] {
  const path = "/asnn";
  const wsCandidates: string[] = [];
  {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    wsCandidates.push(`${proto}://${window.location.host}${path}`);
  }
  {
    const envKey = "VITE_ASNN_MODEL_DASHBOARD_URL";
    const envBase = (import.meta as any).env?.[envKey] as string | undefined;
    if (envBase && typeof envBase === "string") {
      try {
        const u = new URL(envBase);
        u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
        u.pathname = path;
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
