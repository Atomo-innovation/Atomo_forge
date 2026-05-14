import { getOrCreateExportSubdir, loadExportRootDirectoryHandle } from "@/services/detectionFolderExport";

export const DETECTION_EVENTS_CHANGED_EVENT = "atomo-forge:detection-events-changed";

export type StoredDetectionEvent = {
  id: string;
  createdAt: number;
  sessionId: string;
  cameraId: string;
  cameraName?: string;
  modelName?: string;
  label: string;
  score?: number;
  box?: [number, number, number, number];
  cropImage: Blob;
  // Allow forward compatibility: recorder can stash extra fields.
  [k: string]: any;
};

const DB_NAME = "atomo-forge";
const DB_VERSION = 4;
const STORE = "detectionEvents";

function createStores(db: IDBDatabase, tx: IDBTransaction | null): void {
  // Preserve existing stores from earlier versions (e.g. kv from detectionFolderExport).
  if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
  const st = db.objectStoreNames.contains(STORE)
    ? tx?.objectStore(STORE) ?? null
    : db.createObjectStore(STORE, { keyPath: "id" });
  if (!st) return;
  if (!st.indexNames.contains("createdAt")) st.createIndex("createdAt", "createdAt", { unique: false });
  if (!st.indexNames.contains("cameraId")) st.createIndex("cameraId", "cameraId", { unique: false });
}

function deleteDb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve(); // best-effort
    req.onblocked = () => resolve(); // let next open attempt handle it
  });
}

async function openDb(opts?: { allowRecreate?: boolean }): Promise<IDBDatabase> {
  const allowRecreate = opts?.allowRecreate ?? true;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => createStores(req.result, req.transaction ?? null);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
  });

  // Self-heal: if an older run created DB without required store, transactions will fail with NotFoundError.
  if (!db.objectStoreNames.contains(STORE)) {
    db.close();
    if (!allowRecreate) throw new Error(`IndexedDB store "${STORE}" not found`);
    await deleteDb();
    return openDb({ allowRecreate: false });
  }

  return db;
}

function emitChanged(): void {
  try {
    window.dispatchEvent(new Event(DETECTION_EVENTS_CHANGED_EVENT));
  } catch {
    // ignore
  }
}

export async function addDetectionEvent(ev: StoredDetectionEvent): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const st = tx.objectStore(STORE);
    const req = st.put(ev as any);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("Failed to store detection event"));
    tx.oncomplete = () => db.close();
  });

  // Best-effort disk export if user linked a folder.
  void exportEventToDisk(ev).catch(() => null);
  emitChanged();
}

export async function deleteDetectionEvent(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const st = tx.objectStore(STORE);
    const req = st.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("Failed to delete detection event"));
    tx.oncomplete = () => db.close();
  });
  emitChanged();
}

export async function clearAllDetectionEvents(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const st = tx.objectStore(STORE);
    const req = st.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("Failed to clear detection events"));
    tx.oncomplete = () => db.close();
  });
  emitChanged();
}

export async function listDetectionEvents(limit?: number): Promise<StoredDetectionEvent[]> {
  const max = typeof limit === "number" && Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Infinity;
  const db = await openDb();
  const out = await new Promise<StoredDetectionEvent[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const st = tx.objectStore(STORE);
    const idx = st.index("createdAt");
    const results: StoredDetectionEvent[] = [];
    const req = idx.openCursor(null, "prev");

    req.onsuccess = () => {
      const cur = req.result as IDBCursorWithValue | null;
      if (!cur || results.length >= max) {
        resolve(results);
        return;
      }
      results.push(cur.value as StoredDetectionEvent);
      cur.continue();
    };
    req.onerror = () => reject(req.error ?? new Error("Failed to list detection events"));
    tx.oncomplete = () => db.close();
  });

  return out;
}

/** Best-effort: keep stored event labels in sync when the user renames a camera. */
export async function updateCameraDisplayNameOnEvents(cameraId: string, cameraName: string): Promise<void> {
  const cid = String(cameraId || "").trim();
  const name = String(cameraName || "").trim();
  if (!cid || !name) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const st = tx.objectStore(STORE);
    const idx = st.index("cameraId");
    const req = idx.openCursor(IDBKeyRange.only(cid));
    req.onsuccess = () => {
      const cur = req.result as IDBCursorWithValue | null;
      if (!cur) return;
      const row = cur.value as StoredDetectionEvent;
      if (row.cameraName !== name) {
        cur.update({ ...row, cameraName: name });
      }
      cur.continue();
    };
    req.onerror = () => reject(req.error ?? new Error("Failed to update event camera names"));
    tx.oncomplete = () => {
      try {
        db.close();
      } catch {
        // ignore
      }
      emitChanged();
      resolve();
    };
    tx.onerror = () => {
      try {
        db.close();
      } catch {
        // ignore
      }
      reject(tx.error ?? new Error("Transaction failed"));
    };
  });
}

export async function countDetectionEventsByCamera(cameraId: string): Promise<number> {
  const cid = String(cameraId || "").trim();
  if (!cid) return 0;
  const db = await openDb();
  const count = await new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const st = tx.objectStore(STORE);
    const idx = st.index("cameraId");
    const req = idx.count(IDBKeyRange.only(cid));
    req.onsuccess = () => resolve(typeof req.result === "number" ? req.result : 0);
    req.onerror = () => reject(req.error ?? new Error("Failed to count detection events"));
    tx.oncomplete = () => db.close();
  });
  return count;
}

async function exportEventToDisk(ev: StoredDetectionEvent): Promise<void> {
  const root = await loadExportRootDirectoryHandle();
  if (!root) return;

  // Permission check (best effort). If denied, just skip silently.
  try {
    const perm = await (root as any).queryPermission?.({ mode: "readwrite" });
    if (perm === "denied") return;
    if (perm !== "granted") {
      const req = await (root as any).requestPermission?.({ mode: "readwrite" });
      if (req === "denied") return;
    }
  } catch {
    // ignore permission API differences
  }

  const dir = await getOrCreateExportSubdir(root);
  const imagesDir = await dir.getDirectoryHandle("images", { create: true });

  // Write image
  const jpgName = `det-${ev.createdAt}-${ev.id}.jpg`;
  const imgFile = await imagesDir.getFileHandle(jpgName, { create: true });
  {
    const w = await (imgFile as any).createWritable();
    await w.write(ev.cropImage);
    await w.close();
  }

  // Append JSONL
  const jsonlFile = await dir.getFileHandle("events.jsonl", { create: true });
  {
    const lineObj: any = { ...ev };
    delete lineObj.cropImage;
    lineObj.image = `images/${jpgName}`;
    const line = JSON.stringify(lineObj) + "\n";

    // Append by reading existing (good enough for low volume).
    // Note: FileSystemWritableFileStream supports { keepExistingData: true } in Chromium.
    const existingFile = await jsonlFile.getFile();
    const w = await (jsonlFile as any).createWritable({ keepExistingData: true });
    try {
      await w.seek(existingFile.size);
      await w.write(line);
    } finally {
      await w.close();
    }
  }
}

