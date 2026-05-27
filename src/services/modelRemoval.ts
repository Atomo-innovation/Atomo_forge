import { isProtectedModelName, removeDynamicWorkspacesForModel } from "@/lib/dynamicWorkspaces";
import { deleteAsnnModel } from "@/services/asnnModelDashboard";
import { userScopedLocalStorageKey } from "@/services/userScopedStorage";

const CAMERAS_STORAGE_KEY = "atomo-forge:cameras:v1";

async function stopAsnnSession(sessionId: string): Promise<void> {
  try {
    await fetch(`/asnn/api/inference/stop/${encodeURIComponent(sessionId)}`, { method: "POST" });
  } catch {
    // ignore
  }
}

/** Drop cameras (and stop inference) for removed dynamic workspace tab(s). */
export async function purgeCamerasForWorkspaces(
  username: string | null,
  workspaceIds: string[],
): Promise<void> {
  if (!workspaceIds.length) return;
  const key = userScopedLocalStorageKey(CAMERAS_STORAGE_KEY, username);
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return;
  }
  if (!raw) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;

  const wsSet = new Set(workspaceIds);
  const toStop: string[] = [];

  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const cam = item as { detectionWorkspace?: string; inferenceSessionId?: string };
    if (cam.detectionWorkspace && wsSet.has(cam.detectionWorkspace) && cam.inferenceSessionId) {
      toStop.push(cam.inferenceSessionId);
    }
  }

  await Promise.allSettled(toStop.map((sid) => stopAsnnSession(sid)));

  const kept = parsed.filter((item) => {
    if (!item || typeof item !== "object") return true;
    const ws = (item as { detectionWorkspace?: string }).detectionWorkspace;
    return !ws || !wsSet.has(ws);
  });

  try {
    localStorage.setItem(key, JSON.stringify(kept));
  } catch {
    // ignore quota
  }
}

export type RemoveModelResult = {
  ok: boolean;
  removedWorkspaceIds: string[];
  error?: string;
};

/** Delete model folder on disk, remove matching sidebar tab(s), and purge cameras for those tabs. */
export async function removeModelCompletely(
  modelName: string,
  username: string | null,
): Promise<RemoveModelResult> {
  if (isProtectedModelName(modelName)) {
    return {
      ok: false,
      removedWorkspaceIds: [],
      error: "The Person and Safety models cannot be removed (built-in detection tabs).",
    };
  }

  try {
    await deleteAsnnModel(modelName);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to delete model";
    return { ok: false, removedWorkspaceIds: [], error: msg };
  }

  const removedWorkspaceIds = removeDynamicWorkspacesForModel(modelName);
  await purgeCamerasForWorkspaces(username, removedWorkspaceIds);

  return { ok: true, removedWorkspaceIds };
}
