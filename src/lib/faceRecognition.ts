/**
 * Face recognition workspace (cameras3).
 * Detection sends person name + known | unknown — no manual registry in the UI.
 */

export type FaceIdentityClassification = "known" | "unknown";

export const FACE_CLASSIFICATION_LABEL: Record<FaceIdentityClassification, string> = {
  known: "Known",
  unknown: "Unknown",
};

/** Set on detection events when face inference runs. */
export type FaceDetectionMeta = {
  /** Person name from the model (e.g. "Rajat Kumar" or "Unknown"). */
  displayName?: string;
  classification: FaceIdentityClassification;
  matchScore?: number;
};

export function normalizeFaceClassification(
  value: unknown,
): FaceIdentityClassification {
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "known" || s === "recognized" || s === "registered") return "known";
  return "unknown";
}

export function faceIdentityBadgeClass(classification: FaceIdentityClassification): string {
  return classification === "known"
    ? "bg-success/15 text-success border-success/30"
    : "bg-muted text-muted-foreground border-border";
}

/** Primary label for tables — name from detection, else Known / Unknown. */
export function faceDetectionDisplayLabel(
  face: FaceDetectionMeta | undefined,
  fallbackLabel?: string,
): string {
  if (!face) return fallbackLabel?.trim() || "—";
  const name = face.displayName?.trim();
  if (name) return name;
  return FACE_CLASSIFICATION_LABEL[face.classification];
}

export function classificationBadgeLabel(face: FaceDetectionMeta): string {
  return FACE_CLASSIFICATION_LABEL[face.classification];
}

export type FaceListFilter = "all" | "known" | "unknown";

export const FACE_LIST_FILTER_LABEL: Record<FaceListFilter, string> = {
  all: "All",
  known: "Known",
  unknown: "Unknown",
};

export function filterEventsByFaceListFilter<
  T extends { face?: FaceDetectionMeta },
>(events: T[], filter: FaceListFilter): T[] {
  if (filter === "all") return events;
  return events.filter((e) => e.face?.classification === filter);
}

export function countFaceListFilter<T extends { face?: FaceDetectionMeta }>(
  events: T[],
): Record<FaceListFilter, number> {
  let known = 0;
  let unknown = 0;
  for (const e of events) {
    if (e.face?.classification === "known") known += 1;
    else if (e.face?.classification === "unknown") unknown += 1;
  }
  return { all: events.length, known, unknown };
}
