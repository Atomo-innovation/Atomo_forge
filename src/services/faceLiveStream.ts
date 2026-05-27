import type { CameraConfig } from "@/pages/Dashboard";

const FACE_STREAM_PREFIX = "/face-stream";

/** Session id stored on CameraConfig when face recognition is running. */
export const FACE_SESSION_PREFIX = "face:";

export function isFaceInferenceSession(sessionId: string | undefined): boolean {
  return Boolean(sessionId?.startsWith(FACE_SESSION_PREFIX));
}

export function faceSessionIdForCamera(cameraId: string): string {
  return `${FACE_SESSION_PREFIX}${cameraId}`;
}

export function forgeCameraIdFromFaceEventCamId(camId: string): string | null {
  const s = String(camId || "").trim();
  if (!s) return null;
  if (s.startsWith("cam_")) return s.slice(4);
  return s;
}

export function faceStreamApiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${FACE_STREAM_PREFIX}${p}`;
}

export function liveStreamSourceUrl(camera: CameraConfig): string | null {
  if (camera.type === "rtsp") {
    const url = camera.rtspUrl?.trim();
    return url || null;
  }
  if (camera.type === "usb") {
    const dev = camera.device?.replace(/^usb:/i, "").trim() || "0";
    return `usb:${dev}`;
  }
  if (camera.type === "csi") {
    const dev = camera.device?.replace(/^csi:/i, "").trim() || "0";
    return `csi:${dev}`;
  }
  return null;
}

export async function registerFaceStreamCamera(camera: CameraConfig): Promise<{ id: string }> {
  const url = liveStreamSourceUrl(camera);
  if (!url) throw new Error("Camera input is missing (RTSP URL or device)");

  const res = await fetch(faceStreamApiUrl("/api/cameras"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: camera.id,
      name: camera.name,
      url,
    }),
  });
  const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
  if (!res.ok) {
    throw new Error(data?.error || `Face stream register failed (${res.status})`);
  }
  if (!data?.id) throw new Error("Face stream register missing camera id");
  return { id: data.id };
}

export async function unregisterFaceStreamCamera(cameraId: string): Promise<void> {
  const id = encodeURIComponent(cameraId);
  await fetch(faceStreamApiUrl(`/api/cameras/${id}`), { method: "DELETE" }).catch(() => null);
}

export function faceWhepUrl(liveStreamCameraId: string): string {
  return faceStreamApiUrl(`/whep/${encodeURIComponent(liveStreamCameraId)}`);
}
