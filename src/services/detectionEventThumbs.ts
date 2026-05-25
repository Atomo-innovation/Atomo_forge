import { getDetectionEventCrop } from "@/services/detectionEventsStore";
import { detectionEventImageUrl } from "@/services/detectionEventsDb";
import type { CameraWorkspaceId } from "@/pages/Dashboard";

/** Load crop thumbnails only for the given event ids (e.g. current table page). */
export async function loadDetectionEventThumbUrls(
  ids: string[],
  opts?: {
    forgeAccount?: string | null;
    workspaceId?: CameraWorkspaceId | null;
    /** Load thumbnails from auth-server / MySQL (Recent detections when DB is primary). */
    preferServer?: boolean;
    preferServerForIds?: Set<string>;
  },
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out: Record<string, string> = {};
  const preferAllServer = opts?.preferServer === true;
  const preferServer = opts?.preferServerForIds;
  const forgeAccount = opts?.forgeAccount ?? null;
  const workspaceId = opts?.workspaceId ?? null;

  await Promise.all(
    unique.map(async (id) => {
      if (forgeAccount && (preferAllServer || preferServer?.has(id))) {
        out[id] = detectionEventImageUrl(id, forgeAccount, workspaceId);
        return;
      }
      const blob = await getDetectionEventCrop(id);
      if (blob && blob.size > 0) {
        out[id] = URL.createObjectURL(blob);
        return;
      }
      if (forgeAccount && workspaceId) out[id] = detectionEventImageUrl(id, forgeAccount, workspaceId);
    }),
  );
  return out;
}

export function revokeThumbUrls(urls: Record<string, string>): void {
  for (const url of Object.values(urls)) {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }
}
