/** @deprecated Use getInferenceWebSocketCandidates from inferenceWs.ts */
import { getInferenceWebSocketCandidates } from "@/services/inferenceWs";

export function getUniversalWebSocketCandidates(): string[] {
  return getInferenceWebSocketCandidates("asnn");
}
