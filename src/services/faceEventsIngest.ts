import type { CameraConfig } from "@/pages/Dashboard";
import { attachFaceToDetectionEvent } from "@/services/faceInferenceBridge";
import { addDetectionEvent, type StoredDetectionEvent } from "@/services/detectionEventsStore";
import {
  faceStreamApiUrl,
  forgeCameraIdFromFaceEventCamId,
} from "@/services/faceLiveStream";

export type FaceStreamEventPayload = {
  camId?: string;
  camName?: string;
  name?: string;
  known?: boolean;
  score?: number;
  ts?: number;
  crop?: string;
};

function makeId(): string {
  return `face-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function cropBase64ToBlob(b64: string): Blob | null {
  try {
    const raw = b64.includes(",") ? b64.split(",")[1]! : b64;
    const bin = atob(raw);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: "image/jpeg" });
  } catch {
    return null;
  }
}

export function faceStreamEventToStored(
  payload: FaceStreamEventPayload,
  camerasById: Map<string, CameraConfig>,
): StoredDetectionEvent | null {
  const forgeCamId = forgeCameraIdFromFaceEventCamId(String(payload.camId ?? ""));
  if (!forgeCamId) return null;
  const camera = camerasById.get(forgeCamId);
  if (!camera || camera.detectionWorkspace !== "cameras3") return null;

  const crop = typeof payload.crop === "string" ? payload.crop : "";
  const cropImage = crop ? cropBase64ToBlob(crop) : null;
  if (!cropImage) return null;

  const createdAt = typeof payload.ts === "number" && payload.ts > 0 ? payload.ts : Date.now();
  const sessionId = `face:${forgeCamId}`;

  let event: StoredDetectionEvent = {
    id: makeId(),
    createdAt,
    sessionId,
    cameraId: forgeCamId,
    detectionWorkspace: "cameras3",
    cameraName: payload.camName ?? camera.name,
    modelName: "Face recognition",
    label: payload.name?.trim() || (payload.known ? "Known" : "Unknown"),
    score: typeof payload.score === "number" ? payload.score : undefined,
    cropImage,
  };

  event = attachFaceToDetectionEvent(event, {
    name: payload.name,
    known: payload.known,
    matchScore: payload.score,
  });

  return event;
}

let ws: WebSocket | null = null;
let wsRefCount = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelayMs = 2000;
const listeners = new Set<(payload: FaceStreamEventPayload) => void>();

async function faceStreamReachable(): Promise<boolean> {
  try {
    const r = await fetch(faceStreamApiUrl("/api/cameras"), {
      method: "GET",
      signal: AbortSignal.timeout(2500),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function wsUrl(): string {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${faceStreamApiUrl("/ws")}`;
}

function scheduleReconnect(): void {
  if (reconnectTimer || wsRefCount <= 0) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void ensureFaceEventsSocket();
  }, reconnectDelayMs);
  reconnectDelayMs = Math.min(Math.round(reconnectDelayMs * 1.5), 30_000);
}

function ensureFaceEventsSocket(): void {
  if (typeof window === "undefined") return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  void (async () => {
    const up = await faceStreamReachable();
    if (!up) {
      scheduleReconnect();
      return;
    }
    reconnectDelayMs = 2000;

    const url = wsUrl();
    ws = new WebSocket(url);

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as {
        type?: string;
        event?: FaceStreamEventPayload;
        events?: FaceStreamEventPayload[];
      };
      if (msg.type === "face_event" && msg.event) {
        listeners.forEach((fn) => fn(msg.event!));
        return;
      }
      if (msg.type === "face_history" && Array.isArray(msg.events)) {
        for (const e of msg.events) listeners.forEach((fn) => fn(e));
      }
    } catch {
      /* ignore malformed */
    }
  };

    ws.onopen = () => {
      reconnectDelayMs = 2000;
    };

    ws.onclose = () => {
      ws = null;
      if (wsRefCount > 0) scheduleReconnect();
    };
  })();
}

export function subscribeFaceStreamEvents(
  onEvent: (payload: FaceStreamEventPayload) => void,
): () => void {
  wsRefCount += 1;
  listeners.add(onEvent);
  ensureFaceEventsSocket();
  return () => {
    listeners.delete(onEvent);
    wsRefCount = Math.max(0, wsRefCount - 1);
    if (wsRefCount === 0 && ws) {
      ws.close();
      ws = null;
    }
  };
}

export async function persistFaceStreamEvent(
  payload: FaceStreamEventPayload,
  cameras: CameraConfig[],
): Promise<boolean> {
  const map = new Map(cameras.map((c) => [c.id, c]));
  const stored = faceStreamEventToStored(payload, map);
  if (!stored) return false;
  try {
    await addDetectionEvent(stored);
    return true;
  } catch {
    return false;
  }
}
