import type { CameraConfig, CameraWorkspaceId } from "@/pages/Dashboard";

/** All inference uses the embedded asnn-dashboard backend at /asnn */
export const INFERENCE_API_BASE = "/asnn";

export type InferenceBackendId = "asnn";

export function inferenceBackendForWorkspace(_workspaceId?: CameraWorkspaceId): InferenceBackendId {
  return "asnn";
}

export function inferenceBackendForCamera(_camera?: CameraConfig | null): InferenceBackendId {
  return "asnn";
}

export function inferenceApiBase(_backend: InferenceBackendId = "asnn"): string {
  return INFERENCE_API_BASE;
}
