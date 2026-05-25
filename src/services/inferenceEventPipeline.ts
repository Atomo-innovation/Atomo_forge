import type { CameraConfig } from "@/pages/Dashboard";
import { addDetectionEvent } from "@/services/detectionEventsStore";
import { upsertCameraSnapshot } from "@/services/cameraRegistry";

export type InferenceDetection = {
  class_id?: number;
  class_name?: string;
  score?: number;
  box: [number, number, number, number];
};

type Box = [number, number, number, number];

const MIN_EVENT_SCORE = 0.35;
const MAX_EVENTS_PER_FRAME = 8;
const DETECTION_LOST_GAP_MS = 1500;
const TRACK_MATCH_IOU = 0.3;
const MIN_MS_BETWEEN_EVENT_ATTEMPTS_PER_TRACK = 200;
const MAX_TRACKS_PER_SESSION = 64;

type Track = {
  id: string;
  label: string;
  box: Box;
  lastSeenAt: number;
  lastAttemptAt: number;
  recorded: boolean;
};

function iou(a: Box, b: Box): number {
  const xi1 = Math.max(a[0], b[0]);
  const yi1 = Math.max(a[1], b[1]);
  const xi2 = Math.min(a[2], b[2]);
  const yi2 = Math.min(a[3], b[3]);
  const iw = Math.max(0, xi2 - xi1);
  const ih = Math.max(0, yi2 - yi1);
  const inter = iw * ih;
  const aArea = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const bArea = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const union = aArea + bArea - inter;
  return union > 0 ? inter / union : 0;
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function jpegBase64ToImage(jpegB64: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode jpeg frame"));
    img.src = `data:image/jpeg;base64,${jpegB64}`;
  });
}

async function cropDetectionAsJpeg(jpegB64: string, box: [number, number, number, number]): Promise<Blob | null> {
  const img = await jpegBase64ToImage(jpegB64);
  const w = img.naturalWidth || 0;
  const h = img.naturalHeight || 0;
  if (!w || !h) return null;

  const [x1n, y1n, x2n, y2n] = box;
  const x1 = Math.floor(clamp01(x1n) * w);
  const y1 = Math.floor(clamp01(y1n) * h);
  const x2 = Math.ceil(clamp01(x2n) * w);
  const y2 = Math.ceil(clamp01(y2n) * h);
  const cw = Math.max(1, x2 - x1);
  const ch = Math.max(1, y2 - y1);

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, x1, y1, cw, ch, 0, 0, cw, ch);

  return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9));
}

/** Per-session tracker: turns inference frames into stored detection events. */
export function createInferenceEventSink(camera: CameraConfig, sessionId: string) {
  let tracks: Track[] = [];
  let snapshotSaved = false;

  const ingestInferenceFrame = (
    jpeg: string,
    detections: InferenceDetection[],
    opts?: { simulated?: boolean },
  ) => {
    if (opts?.simulated) return;
    if (!jpeg) return;
    if (!snapshotSaved) {
      snapshotSaved = true;
      upsertCameraSnapshot({
        cameraId: camera.id,
        name: camera.name,
        modelName: camera.model,
        modelId: camera.inferenceModelId,
      });
    }

    const now = Date.now();
    tracks = tracks.filter((t) => now - t.lastSeenAt <= DETECTION_LOST_GAP_MS);
    if (!detections.length) return;

    const top = detections
      .filter((d) => d && Array.isArray(d.box) && d.box.length === 4)
      .filter((d) => (typeof d.score === "number" ? d.score : 1) >= MIN_EVENT_SCORE)
      .sort((a, b) => (typeof b.score === "number" ? b.score : 0) - (typeof a.score === "number" ? a.score : 0))
      .slice(0, MAX_EVENTS_PER_FRAME);

    const toRecord: Array<{ track: Track; det: InferenceDetection }> = [];
    const matchedTrackIds = new Set<string>();
    for (const d of top) {
      const label = d.class_name ?? `cls:${d.class_id ?? "?"}`;
      let bestTrack: Track | null = null;
      let bestIou = 0;
      for (const t of tracks) {
        if (t.label !== label) continue;
        if (matchedTrackIds.has(t.id)) continue;
        const score = iou(t.box, d.box);
        if (score > bestIou) {
          bestIou = score;
          bestTrack = t;
        }
      }
      if (bestTrack && bestIou >= TRACK_MATCH_IOU) {
        bestTrack.lastSeenAt = now;
        bestTrack.box = d.box;
        matchedTrackIds.add(bestTrack.id);
        if (!bestTrack.recorded && now - bestTrack.lastAttemptAt >= MIN_MS_BETWEEN_EVENT_ATTEMPTS_PER_TRACK) {
          bestTrack.lastAttemptAt = now;
          toRecord.push({ track: bestTrack, det: d });
        }
      } else {
        if (tracks.length >= MAX_TRACKS_PER_SESSION) continue;
        const track: Track = {
          id: makeId(),
          label,
          box: d.box,
          lastSeenAt: now,
          lastAttemptAt: now,
          recorded: false,
        };
        tracks.push(track);
        toRecord.push({ track, det: d });
      }
    }

    if (!toRecord.length) return;

    void (async () => {
      for (const { track, det } of toRecord) {
        try {
          if (track.recorded) continue;
          const crop = await cropDetectionAsJpeg(jpeg, det.box);
          if (!crop) continue;
          const score = typeof det.score === "number" ? det.score : undefined;
          await addDetectionEvent({
            id: makeId(),
            createdAt: Date.now(),
            sessionId,
            cameraId: camera.id,
            detectionWorkspace: camera.detectionWorkspace ?? "cameras",
            cameraName: camera.name,
            modelName: camera.model,
            label: track.label,
            score,
            box: det.box,
            cropImage: crop,
          });
          track.recorded = true;
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn("[inferenceEventPipeline] failed to save detection event", err);
          }
        }
      }
    })();
  };

  return { ingestInferenceFrame };
}
