import type { InferenceBackendId } from "@/lib/inferenceBackend";
import {
  subscribeInferenceSession,
  type InferenceWsMessage,
} from "@/services/inferenceSessionWs";

export type UniversalWsMessage = InferenceWsMessage;

type Subscriber = {
  onMessage?: (msg: UniversalWsMessage) => void;
  onStatus?: (s: { connected: boolean; status?: string }) => void;
  onError?: (err: string) => void;
};

export function subscribeUniversalSession(
  sessionId: string,
  subscriber: Subscriber,
  opts?: { lingerMs?: number; autoStart?: boolean; backend?: InferenceBackendId },
): () => void {
  const backend: InferenceBackendId = opts?.backend ?? "asnn";
  return subscribeInferenceSession(sessionId, backend, subscriber, opts);
}

