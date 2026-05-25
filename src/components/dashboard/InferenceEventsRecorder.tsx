import { useEffect, useMemo, useRef } from "react";
import type { CameraConfig } from "@/pages/Dashboard";
import { createInferenceEventSink } from "@/services/inferenceEventPipeline";
import { inferenceBackendForCamera } from "@/lib/inferenceBackend";
import { subscribeUniversalSession } from "@/services/universalSessionWs";

export default function InferenceEventsRecorder({
  cameras,
  excludeSessionId,
}: {
  cameras: CameraConfig[];
  excludeSessionId?: string;
}) {
  const sinksRef = useRef(new Map<string, ReturnType<typeof createInferenceEventSink>>());

  const sessions = useMemo(() => {
    const out: Array<{ sessionId: string; camera: CameraConfig }> = [];
    for (const c of cameras) {
      if (!c?.inferenceSessionId) continue;
      if (excludeSessionId && c.inferenceSessionId === excludeSessionId) continue;
      out.push({ sessionId: c.inferenceSessionId, camera: c });
    }
    return out;
  }, [cameras, excludeSessionId]);

  useEffect(() => {
    const activeIds = new Set(sessions.map((s) => s.sessionId));
    for (const sid of [...sinksRef.current.keys()]) {
      if (!activeIds.has(sid)) sinksRef.current.delete(sid);
    }

    const unsubs: Array<() => void> = [];
    for (const { sessionId: sid, camera: cam } of sessions) {
      let sink = sinksRef.current.get(sid);
      if (!sink) {
        sink = createInferenceEventSink(cam, sid);
        sinksRef.current.set(sid, sink);
      }

      const backend = inferenceBackendForCamera(cam);
      const unsub = subscribeUniversalSession(
        sid,
        {
          onMessage: (msg) => {
            if (msg?.type !== "inference") return;
            const jpeg = typeof msg.jpeg === "string" ? (msg.jpeg as string) : null;
            if (!jpeg) return;
            const dets = Array.isArray(msg.detections) ? msg.detections : [];
            sink!.ingestInferenceFrame(jpeg, dets, { simulated: msg.simulated === true });
          },
        },
        { lingerMs: 12000, autoStart: false, backend },
      );
      unsubs.push(unsub);
    }

    return () => unsubs.forEach((u) => u());
  }, [sessions]);

  return null;
}
