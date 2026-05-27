import type { CameraConfig } from "@/pages/Dashboard";
import { INFERENCE_API_BASE } from "@/lib/inferenceBackend";
import { isFaceInferenceSession } from "@/services/faceLiveStream";

export type InferenceSessionInfo = {
  id: string;
  status?: string;
  simulated?: boolean;
  running?: boolean;
};

export async function fetchInferenceSessions(): Promise<InferenceSessionInfo[] | null> {
  try {
    const res = await fetch(`${INFERENCE_API_BASE}/api/inference/sessions`);
    if (!res.ok) return null;
    const data = (await res.json()) as { sessions?: InferenceSessionInfo[] };
    const list = Array.isArray(data.sessions) ? data.sessions : [];
    return list.filter((s) => typeof s.id === "string" && s.id);
  } catch {
    return null;
  }
}

export async function fetchActiveInferenceSessionIds(): Promise<Set<string> | null> {
  const list = await fetchInferenceSessions();
  if (!list) return null;

  const ids = new Set<string>();
  for (const s of list) {
    if (s.simulated) continue;
    const status = String(s.status || "").toLowerCase();
    // "ready" = created by /inference/start, waiting for WS — still valid (do not clear).
    if (status === "error" || status === "stopped") continue;
    ids.add(s.id);
  }
  return ids;
}

export async function reconcileCameraInferenceSessions(
  cameras: CameraConfig[],
  onUpdateCamera: (cameraId: string, patch: Partial<CameraConfig>) => void,
): Promise<void> {
  const withSid = cameras.filter((c) => c.inferenceSessionId);
  if (!withSid.length) return;

  const active = await fetchActiveInferenceSessionIds();
  if (!active) return;

  for (const cam of withSid) {
    const sid = cam.inferenceSessionId!;
    if (isFaceInferenceSession(sid)) continue;
    if (active.has(sid)) continue;
    onUpdateCamera(cam.id, {
      inferenceSessionId: undefined,
      inferenceModelId: undefined,
      inferenceStartedAt: undefined,
    });
  }
}

export function sessionsApiForCamera(_camera: CameraConfig): string {
  return `${INFERENCE_API_BASE}/api/inference/sessions`;
}
