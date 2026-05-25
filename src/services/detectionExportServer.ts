import { authApiUrl, readForgeApiJson } from "@/services/authApiUrl";
import { EXPORT_FOLDER_LINK_CHANGED, type ExportWorkspaceId } from "@/services/detectionFolderExport";
import type { StoredDetectionEvent } from "@/services/detectionEventsStore";

const LS_PREFIX = "atomo-forge:server-export-path:";

let serverExportAvailable: boolean | null = null;

export async function fetchServerExportAvailable(): Promise<boolean> {
  if (serverExportAvailable !== null) return serverExportAvailable;
  try {
    const r = await fetch(authApiUrl("/api/detection-export/status"));
    const data = await readForgeApiJson<{ ok?: boolean; serverExport?: boolean; apiVersion?: number }>(r);
    serverExportAvailable = Boolean(data?.ok && data.serverExport);
  } catch {
    serverExportAvailable = false;
  }
  return serverExportAvailable;
}

export function getCachedServerExportPath(workspaceId: ExportWorkspaceId): string | null {
  try {
    const v = localStorage.getItem(`${LS_PREFIX}${workspaceId}`);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function cacheServerExportPath(workspaceId: ExportWorkspaceId, folderPath: string | null): void {
  try {
    const key = `${LS_PREFIX}${workspaceId}`;
    if (folderPath) localStorage.setItem(key, folderPath);
    else localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export async function loadServerExportFolders(): Promise<Partial<Record<ExportWorkspaceId, string>>> {
  try {
    const r = await fetch(authApiUrl("/api/detection-export/folders"));
    const data = await readForgeApiJson<{
      ok?: boolean;
      workspaces?: Record<string, { folderPath?: string }>;
    }>(r);
    if (!data?.ok || !data.workspaces) return {};
    const out: Partial<Record<ExportWorkspaceId, string>> = {};
    for (const [id, entry] of Object.entries(data.workspaces)) {
      const p = entry?.folderPath?.trim();
      if (p) {
        out[id as ExportWorkspaceId] = p;
        cacheServerExportPath(id as ExportWorkspaceId, p);
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function getServerExportPath(workspaceId: ExportWorkspaceId): Promise<string | null> {
  const cached = getCachedServerExportPath(workspaceId);
  if (cached) return cached;
  const all = await loadServerExportFolders();
  return all[workspaceId] ?? null;
}

function applyPickResult(
  workspaceId: ExportWorkspaceId,
  data: { ok?: boolean; aborted?: boolean; error?: string; folderPath?: string } | null,
  httpStatus: number,
): { ok: boolean; aborted?: boolean; error?: string; folderPath?: string } {
  if (data?.aborted) return { ok: false, aborted: true };
  if (data?.ok) {
    const resolved = data.folderPath?.trim();
    if (resolved) cacheServerExportPath(workspaceId, resolved);
    try {
      window.dispatchEvent(new CustomEvent(EXPORT_FOLDER_LINK_CHANGED, { detail: { workspaceId } }));
    } catch {
      /* ignore */
    }
    return { ok: true, folderPath: resolved };
  }
  return {
    ok: false,
    error:
      httpStatus === 404
        ? "Restart npm run dev so the folder dialog can load."
        : (data?.error ?? `HTTP ${httpStatus}`),
  };
}

/** Opens the OS folder dialog on the device running auth-server (http:// / board). */
export async function pickServerExportFolder(
  workspaceId: ExportWorkspaceId,
  title?: string,
): Promise<{ ok: boolean; aborted?: boolean; error?: string; folderPath?: string }> {
  const body = JSON.stringify({ workspaceId, title, openPicker: true });

  try {
    let r = await fetch(authApiUrl("/api/detection-export/pick-folder"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (r.status === 404) {
      r = await fetch(authApiUrl("/api/detection-export/folders"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
      });
    }
    const data = await readForgeApiJson<{
      ok?: boolean;
      aborted?: boolean;
      error?: string;
      folderPath?: string;
    }>(r);
    return applyPickResult(workspaceId, data, r.status);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to open folder picker" };
  }
}

export async function setServerExportFolder(
  workspaceId: ExportWorkspaceId,
  folderPath: string,
): Promise<{ ok: boolean; error?: string; folderPath?: string }> {
  try {
    const r = await fetch(authApiUrl("/api/detection-export/folders"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, folderPath: folderPath.trim() }),
    });
    const data = await readForgeApiJson<{ ok?: boolean; error?: string; folderPath?: string }>(r);
    if (!data?.ok) return { ok: false, error: data?.error ?? `HTTP ${r.status}` };
    const resolved = data.folderPath?.trim() ?? folderPath.trim();
    cacheServerExportPath(workspaceId, resolved || null);
    try {
      window.dispatchEvent(new CustomEvent(EXPORT_FOLDER_LINK_CHANGED, { detail: { workspaceId } }));
    } catch {
      /* ignore */
    }
    return { ok: true, folderPath: resolved };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to set export folder" };
  }
}

export async function clearServerExportFolder(workspaceId: ExportWorkspaceId): Promise<void> {
  try {
    await fetch(authApiUrl("/api/detection-export/folders"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, folderPath: null }),
    });
  } catch {
    // ignore
  }
  cacheServerExportPath(workspaceId, null);
  try {
    window.dispatchEvent(new CustomEvent(EXPORT_FOLDER_LINK_CHANGED, { detail: { workspaceId } }));
  } catch {
    /* ignore */
  }
}

export async function clearAllServerExportFolders(): Promise<void> {
  const ids: ExportWorkspaceId[] = ["cameras", "cameras2", "cameras3", "cameras4"];
  await Promise.allSettled(ids.map((id) => clearServerExportFolder(id)));
}

async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") {
        reject(new Error("Failed to encode image"));
        return;
      }
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image blob"));
    reader.readAsDataURL(blob);
  });
}

export async function exportDetectionEventViaServer(
  ev: StoredDetectionEvent,
  workspaceId: ExportWorkspaceId,
): Promise<{ ok: boolean; error?: string }> {
  if (!ev.cropImage) return { ok: false, error: "Missing crop image" };
  try {
    const cropBase64 = await blobToBase64(ev.cropImage);
    const { cropImage: _c, ...event } = ev;
    const r = await fetch(authApiUrl("/api/detection-export/event"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, event, cropBase64 }),
    });
    const data = await readForgeApiJson<{ ok?: boolean; error?: string }>(r);
    if (!data?.ok) return { ok: false, error: data?.error ?? `HTTP ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Server export failed" };
  }
}
