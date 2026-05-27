import { useEffect } from "react";
import type { CameraConfig } from "@/pages/Dashboard";
import { persistFaceStreamEvent, subscribeFaceStreamEvents } from "@/services/faceEventsIngest";

/** Subscribes to live_stream WebSocket and stores face events for cameras3. */
export default function FaceInferenceEventsRecorder({ cameras }: { cameras: CameraConfig[] }) {
  const hasFaceWorkspace = cameras.some((c) => c.detectionWorkspace === "cameras3");

  useEffect(() => {
    if (!hasFaceWorkspace) return undefined;

    const unsub = subscribeFaceStreamEvents((payload) => {
      void persistFaceStreamEvent(payload, cameras);
    });

    return unsub;
  }, [cameras, hasFaceWorkspace]);

  return null;
}
