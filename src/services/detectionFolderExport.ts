export const EXPORT_FOLDER_LINK_CHANGED = "atomo-forge:export-folder-link-changed";
export const EXPORT_SUBDIR = "atomo-forge-exports";

const DB_NAME = "atomo-forge";
// Must be >= any other module opening the same DB (e.g. detectionEventsStore).
const DB_VERSION = 3;
const STORE = "kv";
const KEY = "exportRootDirectoryHandle";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
  });
}

async function kvGet<T>(k: string): Promise<T | null> {
  const db = await openDb();
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
  const db = await openDb();
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
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const st = tx.objectStore(STORE);
    const req = st.delete(k);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IndexedDB delete failed"));
    tx.oncomplete = () => db.close();
  });
}

export function isFolderDiskExportSupported(): boolean {
  return typeof (window as any).showDirectoryPicker === "function";
}

export async function loadExportRootDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const h = await kvGet<FileSystemDirectoryHandle>(KEY);
    return h ?? null;
  } catch {
    return null;
  }
}

export async function clearExportRootDirectoryHandle(): Promise<void> {
  try {
    await kvDel(KEY);
  } catch {
    // ignore
  } finally {
    try {
      window.dispatchEvent(new Event(EXPORT_FOLDER_LINK_CHANGED));
    } catch {
      // ignore
    }
  }
}

export async function pickAndLinkExportFolder(): Promise<{ ok: boolean; aborted?: boolean; error?: string }> {
  if (!isFolderDiskExportSupported()) return { ok: false, error: "This browser does not support folder export." };
  try {
    const root = await (window as any).showDirectoryPicker({ mode: "readwrite" });
    if (!root) return { ok: false, aborted: true };
    await kvSet(KEY, root);
    window.dispatchEvent(new Event(EXPORT_FOLDER_LINK_CHANGED));
    return { ok: true };
  } catch (e: any) {
    const name = typeof e?.name === "string" ? e.name : "";
    if (name === "AbortError") return { ok: false, aborted: true };
    const msg = e instanceof Error ? e.message : "Failed to pick export folder";
    return { ok: false, error: msg };
  }
}

export async function getOrCreateExportSubdir(root: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> {
  // Keep all files under a fixed subdirectory to avoid polluting user-chosen folder.
  return await root.getDirectoryHandle(EXPORT_SUBDIR, { create: true });
}

