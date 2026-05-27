import type { CameraConfig, CameraWorkspaceId } from "@/pages/Dashboard";

/** ASNN object-detection backend */
export const INFERENCE_API_BASE = "/asnn";

export type InferenceBackendId = "asnn" | "face";

export function inferenceBackendForWorkspace(workspaceId?: CameraWorkspaceId): InferenceBackendId {
  return workspaceId === "cameras3" ? "face" : "asnn";
}

export function inferenceBackendForCamera(camera?: CameraConfig | null): InferenceBackendId {
  if (camera?.detectionWorkspace === "cameras3") return "face";
  return "asnn";
}

export function inferenceApiBase(backend: InferenceBackendId = "asnn"): string {
  return backend === "face" ? "/face-stream" : INFERENCE_API_BASE;
}
