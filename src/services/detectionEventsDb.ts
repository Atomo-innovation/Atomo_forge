import { authApiUrl, readForgeApiJson } from "@/services/authApiUrl";
import type { StoredDetectionEvent } from "@/services/detectionEventsStore";
import { getActiveForgeUsername } from "@/services/userScopedStorage";
import type { CameraWorkspaceId } from "@/pages/Dashboard";

export type DbDetectionEvent = StoredDetectionEvent & { imageFromServer?: boolean };

export const DETECTION_EVENTS_DB_CHANGED_EVENT = "atomo-forge:detection-events-db-changed";

let dbAvailable: boolean | null = null;

export function resetDetectionEventsDbCache(): void {
  dbAvailable = null;
}

function notifyDbChanged(): void {
  try {
    window.dispatchEvent(new Event(DETECTION_EVENTS_DB_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

export async function fetchDetectionEventsDbAvailable(force = false): Promise<boolean> {
  if (!force && dbAvailable !== null) return dbAvailable;
  try {
    const r = await fetch(authApiUrl("/api/detection-events/status"));
    const data = await readForgeApiJson<{ ok?: boolean; dbAvailable?: boolean }>(r);
    dbAvailable = Boolean(data?.ok && data.dbAvailable);
  } catch {
    dbAvailable = false;
  }
  return dbAvailable;
}

export function detectionEventImageUrl(id: string, forgeAccount?: string | null): string {
  const u = forgeAccount?.trim().toLowerCase();
  const q = u ? `?forgeAccount=${encodeURIComponent(u)}` : "";
  return authApiUrl(`/api/detection-events/${encodeURIComponent(id)}/image${q}`);
}

function currentForgeAccount(): string | null {
  return getActiveForgeUsername();
}

/** Save crop + metadata to MySQL and disk (auth-server). Returns true when stored. */
export async function persistDetectionEventToDb(ev: StoredDetectionEvent): Promise<boolean> {
  const forgeAccount = currentForgeAccount();
  if (!forgeAccount || !ev.cropImage?.size) return false;
  if (!(await fetchDetectionEventsDbAvailable())) return false;

  const fd = new FormData();
  fd.append("crop", ev.cropImage, `det-${ev.id}.jpg`);
  fd.append("forgeAccount", forgeAccount);
  fd.append("id", ev.id);
  fd.append("createdAtMs", String(ev.createdAt));
  fd.append("detectionWorkspace", ev.detectionWorkspace ?? "cameras");
  fd.append("cameraId", ev.cameraId);
  if (ev.cameraName) fd.append("cameraName", ev.cameraName);
  if (ev.modelName) fd.append("modelName", ev.modelName);
  fd.append("label", ev.label);
  if (typeof ev.score === "number") fd.append("score", String(ev.score));
  if (ev.sessionId) fd.append("sessionId", ev.sessionId);
  if (ev.box) fd.append("boxJson", JSON.stringify(ev.box));

  try {
    const r = await fetch(authApiUrl("/api/detection-events/event"), { method: "POST", body: fd });
    const data = await readForgeApiJson<{ ok?: boolean; error?: string }>(r);
    if (!r.ok || !data?.ok) {
      resetDetectionEventsDbCache();
      if (import.meta.env.DEV) {
        console.warn("[detectionEventsDb] save failed:", data?.error ?? r.status);
      }
      return false;
    }
    notifyDbChanged();
    return true;
  } catch (err) {
    resetDetectionEventsDbCache();
    if (import.meta.env.DEV) {
      console.warn("[detectionEventsDb] save error:", err);
    }
    return false;
  }
}

export async function listDetectionEventsFromDb(opts: {
  workspaceId: CameraWorkspaceId;
  cameraIds: string[];
  limit?: number;
}): Promise<DbDetectionEvent[]> {
  return searchDetectionEventsInDb({ ...opts, q: "" });
}

export async function searchDetectionEventsInDb(opts: {
  workspaceId: CameraWorkspaceId;
  cameraIds: string[];
  q: string;
  limit?: number;
}): Promise<DbDetectionEvent[]> {
  const forgeAccount = currentForgeAccount();
  if (!forgeAccount) return [];
  if (!(await fetchDetectionEventsDbAvailable())) return [];

  const params = new URLSearchParams({
    forgeAccount,
    workspace: opts.workspaceId,
    limit: String(opts.limit ?? 200),
  });
  const q = opts.q.trim();
  if (q) params.set("q", q);
  if (opts.cameraIds.length) params.set("cameraIds", opts.cameraIds.join(","));

  try {
    const r = await fetch(authApiUrl(`/api/detection-events/search?${params.toString()}`));
    const data = await readForgeApiJson<{
      ok?: boolean;
      dbAvailable?: boolean;
      events?: DbDetectionEvent[];
    }>(r);
    if (!data?.ok || !data.dbAvailable || !Array.isArray(data.events)) return [];
    return data.events.map((e) => ({ ...e, imageFromServer: true }));
  } catch {
    return [];
  }
}

/** Client-side filter when MySQL is unavailable (same fields as Events tab). */
export function filterDetectionEventsLocal(
  events: StoredDetectionEvent[],
  opts: { workspaceId: CameraWorkspaceId; cameraIds: Set<string>; q: string },
): StoredDetectionEvent[] {
  const q = opts.q.trim().toLowerCase();
  const formatDateTime = (ts: number) => {
    try {
      return new Date(ts).toLocaleString(undefined, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return String(ts);
    }
  };

  return events
    .filter((e) => opts.cameraIds.has(e.cameraId))
    .filter((e) => (e.detectionWorkspace ?? "cameras") === opts.workspaceId)
    .filter((e) => {
      if (!q) return true;
      const score =
        typeof e.score === "number" ? `${(e.score * 100).toFixed(1)}%` : "";
      const hay = `${e.label} ${e.cameraName ?? ""} ${e.modelName ?? ""} ${e.cameraId} ${score} ${formatDateTime(e.createdAt)}`.toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}
