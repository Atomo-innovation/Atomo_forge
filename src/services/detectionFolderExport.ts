import { onForgeUserScopeChanged, userScopedDbName } from "@/services/userScopedStorage";

export const EXPORT_FOLDER_LINK_CHANGED = "atomo-forge:export-folder-link-changed";
export const EXPORT_SUBDIR = "atomo-forge-exports";

/** One export folder per detection sidebar workspace. */
export type ExportWorkspaceId = "cameras" | "cameras2" | "cameras3" | "cameras4";

export const EXPORT_WORKSPACE_IDS: readonly ExportWorkspaceId[] = [
  "cameras",
  "cameras2",
  "cameras3",
  "cameras4",
];

export type ExportFolderLinkChangedDetail = { workspaceId: ExportWorkspaceId };

const DB_NAME_BASE = "atomo-forge";
// Must be >= any other module opening the same DB (e.g. detectionEventsStore).
const DB_VERSION = 5;
const STORE = "kv";
/** Pre–per-workspace single folder (migrated into Person / cameras). */
const LEGACY_KEY = "exportRootDirectoryHandle";

function storageKey(workspaceId: ExportWorkspaceId): string {
  return `exportRootDirectoryHandle:${workspaceId}`;
}

function currentDbName(): string {
  return userScopedDbName(DB_NAME_BASE);
}

function openDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
  });
}

async function kvGet<T>(k: string): Promise<T | null> {
  const db = await openDb(currentDbName());
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const st = tx.objectStore(STORE);
    const req = st.get(k);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB get failed"));
    tx.oncomplete = () => db.close();
  });
}

async function kvSet<T>(k: string, v: T): Promise<void> {
  const db = await openDb(currentDbName());
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const st = tx.objectStore(STORE);
    const req = st.put(v as any, k);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IndexedDB put failed"));
    tx.oncomplete = () => db.close();
  });
}

async function kvDel(k: string): Promise<void> {
  const db = await openDb(currentDbName());
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const st = tx.objectStore(STORE);
    const req = st.delete(k);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IndexedDB delete failed"));
    tx.oncomplete = () => db.close();
  });
}

function emitExportFolderLinkChanged(workspaceId: ExportWorkspaceId): void {
  try {
    window.dispatchEvent(
      new CustomEvent<ExportFolderLinkChangedDetail>(EXPORT_FOLDER_LINK_CHANGED, {
        detail: { workspaceId },
      }),
    );
  } catch {
    // ignore
  }
}

/** Browser folder picker (needs secure context: https:// or localhost). */
export function canUseBrowserFolderPicker(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      window.isSecureContext === true &&
      typeof (window as any).showDirectoryPicker === "function"
    );
  } catch {
    return false;
  }
}

/** @deprecated Use canUseBrowserFolderPicker — kept for older imports. */
export function isFolderDiskExportSupported(): boolean {
  return canUseBrowserFolderPicker();
}

/** Migrate old single-folder link into Person (cameras) workspace. */
async function migrateLegacyHandleIfNeeded(workspaceId: ExportWorkspaceId): Promise<FileSystemDirectoryHandle | null> {
  if (workspaceId !== "cameras") return null;
  try {
    const legacy = await kvGet<FileSystemDirectoryHandle>(LEGACY_KEY);
    if (!legacy) return null;
    const existing = await kvGet<FileSystemDirectoryHandle>(storageKey("cameras"));
    if (!existing) await kvSet(storageKey("cameras"), legacy);
    await kvDel(LEGACY_KEY);
    return legacy;
  } catch {
    return null;
  }
}

export async function loadExportRootDirectoryHandle(
  workspaceId: ExportWorkspaceId,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    const h = await kvGet<FileSystemDirectoryHandle>(storageKey(workspaceId));
    if (h) return h;
    return (await migrateLegacyHandleIfNeeded(workspaceId)) ?? null;
  } catch {
    return null;
  }
}

export async function clearExportRootDirectoryHandle(workspaceId: ExportWorkspaceId): Promise<void> {
  try {
    await kvDel(storageKey(workspaceId));
    if (workspaceId === "cameras") await kvDel(LEGACY_KEY);
  } catch {
    // ignore
  } finally {
    emitExportFolderLinkChanged(workspaceId);
  }
}

export async function clearAllExportRootDirectoryHandles(): Promise<void> {
  try {
    await kvDel(LEGACY_KEY);
    for (const id of EXPORT_WORKSPACE_IDS) {
      await kvDel(storageKey(id));
    }
  } catch {
    // ignore
  } finally {
    for (const id of EXPORT_WORKSPACE_IDS) {
      emitExportFolderLinkChanged(id);
    }
  }
}

export async function pickAndLinkExportFolder(
  workspaceId: ExportWorkspaceId,
): Promise<{ ok: boolean; aborted?: boolean; error?: string }> {
  if (!canUseBrowserFolderPicker()) return { ok: false, error: "Browser folder picker unavailable (use HTTPS or device path)." };
  try {
    const root = await (window as any).showDirectoryPicker({ mode: "readwrite" });
    if (!root) return { ok: false, aborted: true };
    await kvSet(storageKey(workspaceId), root);
    if (workspaceId === "cameras") await kvDel(LEGACY_KEY);
    emitExportFolderLinkChanged(workspaceId);
    return { ok: true };
  } catch (e: any) {
    const name = typeof e?.name === "string" ? e.name : "";
    if (name === "AbortError") return { ok: false, aborted: true };
    const msg = e instanceof Error ? e.message : "Failed to pick export folder";
    return { ok: false, error: msg };
  }
}

export async function getOrCreateExportSubdir(root: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> {
  return await root.getDirectoryHandle(EXPORT_SUBDIR, { create: true });
}

onForgeUserScopeChanged(() => {
  // Handles are per-user in scoped DB; UI will re-read on navigation.
});
