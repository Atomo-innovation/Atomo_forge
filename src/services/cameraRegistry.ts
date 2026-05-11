/**
 * Persist a lightweight snapshot of camera metadata (name/model) by cameraId.
 *
 * Why: even if the user deletes a camera from the UI later, old events should still
 * show the camera name + model/service reliably.
 */

export type CameraSnapshot = {
  cameraId: string;
  name: string;
  modelName?: string;
  modelId?: string;
  updatedAt: number;
};

const KEY = "atomo-forge:camera-registry:v1";

function readAll(): Record<string, CameraSnapshot> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, CameraSnapshot>;
  } catch {
    return {};
  }
}

function writeAll(next: Record<string, CameraSnapshot>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function upsertCameraSnapshot(s: Omit<CameraSnapshot, "updatedAt">): void {
  if (!s.cameraId) return;
  const name = (s.name ?? "").trim();
  if (!name) return;
  const all = readAll();
  all[s.cameraId] = {
    cameraId: s.cameraId,
    name,
    modelName: typeof s.modelName === "string" && s.modelName.trim() ? s.modelName.trim() : undefined,
    modelId: typeof s.modelId === "string" && s.modelId.trim() ? s.modelId.trim() : undefined,
    updatedAt: Date.now(),
  };
  writeAll(all);
}

export function getCameraSnapshot(cameraId: string): CameraSnapshot | null {
  if (!cameraId) return null;
  const all = readAll();
  const v = all[cameraId];
  return v && typeof v === "object" ? v : null;
}

export function clearCameraRegistry(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

