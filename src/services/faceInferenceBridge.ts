/**
 * Maps face-detection API / WebSocket payloads onto StoredDetectionEvent.face.
 */
import {
  normalizeFaceClassification,
  type FaceDetectionMeta,
  type FaceIdentityClassification,
} from "@/lib/faceRecognition";
import type { StoredDetectionEvent } from "@/services/detectionEventsStore";

/** Shape detection is expected to send (fields may vary — we normalize). */
export type FaceDetectionPayload = {
  personName?: string;
  name?: string;
  displayName?: string;
  label?: string;
  classification?: string;
  known?: boolean;
  isKnown?: boolean;
  matchScore?: number;
  score?: number;
};

export function faceMetaFromDetectionPayload(payload: FaceDetectionPayload): FaceDetectionMeta {
  const displayName =
    payload.personName?.trim() ||
    payload.displayName?.trim() ||
    payload.name?.trim() ||
    payload.label?.trim() ||
    undefined;

  let classification: FaceIdentityClassification;
  if (typeof payload.known === "boolean") {
    classification = payload.known ? "known" : "unknown";
  } else if (typeof payload.isKnown === "boolean") {
    classification = payload.isKnown ? "known" : "unknown";
  } else {
    classification = normalizeFaceClassification(payload.classification);
  }

  const matchScore =
    typeof payload.matchScore === "number"
      ? payload.matchScore
      : typeof payload.score === "number"
        ? payload.score
        : undefined;

  return { displayName, classification, matchScore };
}

/** Attach face fields from detection before persisting (cameras3). */
export function attachFaceToDetectionEvent(
  event: StoredDetectionEvent,
  payload: FaceDetectionPayload,
): StoredDetectionEvent {
  if (event.detectionWorkspace && event.detectionWorkspace !== "cameras3") return event;
  const face = faceMetaFromDetectionPayload(payload);
  const label = face.displayName ?? faceDetectionEventLabel(face);
  return { ...event, face, label };
}

function faceDetectionEventLabel(face: FaceDetectionMeta): string {
  if (face.displayName) return face.displayName;
  return face.classification === "known" ? "Known" : "Unknown";
}
