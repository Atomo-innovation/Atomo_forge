/** Dynamic detection tabs (cameras5–9) created when uploading a custom model. */
export const DYNAMIC_WS_KEY = "atomo-forge:dynamic-workspaces:v1";

export const DYNAMIC_WORKSPACE_IDS = [
  "cameras5",
  "cameras6",
  "cameras7",
  "cameras8",
  "cameras9",
] as const;

/** Built-in Person / Safety workspaces depend on these model folders. */
const PROTECTED_MODEL_NAMES = new Set(["person", "safety"]);

export function isProtectedModelName(name: string): boolean {
  return PROTECTED_MODEL_NAMES.has(name.trim().toLowerCase());
}

export function loadDynamicWorkspaces(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DYNAMIC_WS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveDynamicWorkspace(id: string, title: string): void {
  const existing = loadDynamicWorkspaces();
  existing[id] = title;
  localStorage.setItem(DYNAMIC_WS_KEY, JSON.stringify(existing));
  window.dispatchEvent(new Event("storage"));
}

/** Remove sidebar tab(s) whose label matches the model folder name. */
export function removeDynamicWorkspacesForModel(modelName: string): string[] {
  const dynamic = loadDynamicWorkspaces();
  const norm = modelName.trim().toLowerCase();
  const removed: string[] = [];
  for (const [id, title] of Object.entries(dynamic)) {
    if (title.trim().toLowerCase() === norm) {
      delete dynamic[id];
      removed.push(id);
    }
  }
  if (removed.length) {
    localStorage.setItem(DYNAMIC_WS_KEY, JSON.stringify(dynamic));
    window.dispatchEvent(new Event("storage"));
  }
  return removed;
}

export function removeDynamicWorkspaceById(workspaceId: string): boolean {
  const dynamic = loadDynamicWorkspaces();
  if (!(workspaceId in dynamic)) return false;
  delete dynamic[workspaceId];
  localStorage.setItem(DYNAMIC_WS_KEY, JSON.stringify(dynamic));
  window.dispatchEvent(new Event("storage"));
  return true;
}

export function findNextDynamicWorkspaceId(): string | undefined {
  const existingKeys = ["cameras", "cameras2", "cameras3", "cameras4"];
  const dynamic = loadDynamicWorkspaces();
  const usedIds = [...existingKeys, ...Object.keys(dynamic)];
  return DYNAMIC_WORKSPACE_IDS.find((id) => !usedIds.includes(id));
}

export function registerDynamicWorkspaceForModel(folderName: string): string | undefined {
  const nextId = findNextDynamicWorkspaceId();
  if (!nextId) return undefined;
  saveDynamicWorkspace(nextId, folderName);
  return nextId;
}
