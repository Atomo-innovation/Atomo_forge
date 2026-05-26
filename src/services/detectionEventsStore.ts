import type { FaceDetectionMeta } from "@/lib/faceRecognition";
import { loadExportRootDirectoryHandle, type ExportWorkspaceId } from "@/services/detectionFolderExport";
import { exportDetectionEventViaServer, getServerExportPath } from "@/services/detectionExportServer";
import { persistDetectionEventToDb } from "@/services/detectionEventsDb";
import { onForgeUserScopeChanged, userScopedDbName } from "@/services/userScopedStorage";

export const DETECTION_EVENTS_CHANGED_EVENT = "atomo-forge:detection-events-changed";

/** Default cap for Events screen — metadata only, no crop blobs. */
export const EVENTS_LIST_DEFAULT_LIMIT = 2000;

export type StoredDetectionEvent = {
  id: string;
  createdAt: number;
  sessionId: string;
  cameraId: string;
  /** Which detection tab produced this event — selects the per-workspace export folder. */
  detectionWorkspace?: ExportWorkspaceId;
  cameraName?: string;
  modelName?: string;
  label: string;
  score?: number;
  box?: [number, number, number, number];
  /** Face workspace (cameras3): person name + known | unknown from detection. */
  face?: FaceDetectionMeta;
  /** Present when loaded with crop; omitted in fast metadata-only lists. */
  cropImage?: Blob;
  [k: string]: any;
};

type EventMeta = Omit<StoredDetectionEvent, "cropImage">;

const DB_NAME_BASE = "atomo-forge";
/** Pre–per-user IndexedDB (events lived here before user scoping). */
const LEGACY_GLOBAL_DB_NAME = "atomo-forge";
const DB_VERSION = 5;
/** Legacy v4 store (migrated to meta + crops on upgrade). */
const LEGACY_STORE = "detectionEvents";
const META_STORE = "detectionEventMeta";
const CROP_STORE = "detectionEventCrops";

let dbPromise: Promise<IDBDatabase> | null = null;
let dbScopeName: string | null = null;
let eventsListCache: StoredDetectionEvent[] | null = null;

function currentDbName(): string {
  return userScopedDbName(DB_NAME_BASE);
}

function resetDbScope(): void {
  dbPromise = null;
  dbScopeName = null;
  emitChanged();
}

onForgeUserScopeChanged(resetDbScope);

export function getDetectionEventsCache(): StoredDetectionEvent[] | null {
  return eventsListCache;
}

function invalidateEventsListCache(): void {
  eventsListCache = null;
}

function setEventsListCache(events: StoredDetectionEvent[]): void {
  eventsListCache = events;
}

function createStores(db: IDBDatabase, tx: IDBTransaction | null): void {
  if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");

  if (!db.objectStoreNames.contains(META_STORE)) {
    const meta = db.createObjectStore(META_STORE, { keyPath: "id" });
    meta.createIndex("createdAt", "createdAt", { unique: false });
    meta.createIndex("cameraId", "cameraId", { unique: false });
  }

  if (!db.objectStoreNames.contains(CROP_STORE)) {
    db.createObjectStore(CROP_STORE, { keyPath: "id" });
  }

  // Legacy store (v4) — kept until migration runs.
  if (!db.objectStoreNames.contains(LEGACY_STORE)) {
    const st = db.createObjectStore(LEGACY_STORE, { keyPath: "id" });
    st.createIndex("createdAt", "createdAt", { unique: false });
    st.createIndex("cameraId", "cameraId", { unique: false });
  }

  migrateLegacyEventsIfNeeded(db, tx);
}

function migrateLegacyEventsIfNeeded(db: IDBDatabase, tx: IDBTransaction | null): void {
  if (!tx || !db.objectStoreNames.contains(LEGACY_STORE) || !db.objectStoreNames.contains(META_STORE)) return;

  const legacy = tx.objectStore(LEGACY_STORE);
  const meta = tx.objectStore(META_STORE);
  const crops = tx.objectStore(CROP_STORE);

  const countReq = meta.count();
  countReq.onsuccess = () => {
    if ((countReq.result as number) > 0) return;

    const cursorReq = legacy.openCursor();
    cursorReq.onsuccess = () => {
      const cur = cursorReq.result as IDBCursorWithValue | null;
      if (!cur) {
        try {
          legacy.clear();
        } catch {
          // ignore
        }
        return;
      }
      const row = cur.value as StoredDetectionEvent;
      const { cropImage, ...metaRow } = row;
      meta.put(metaRow as EventMeta);
      if (cropImage) crops.put({ id: row.id, cropImage });
      cur.continue();
    };
  };
}

function deleteDb(dbName: string): Promise<void> {
  return new Promise((resolve) => {
    dbPromise = null;
    dbScopeName = null;
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

async function openDb(dbName: string, opts?: { allowRecreate?: boolean }): Promise<IDBDatabase> {
  const allowRecreate = opts?.allowRecreate ?? true;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onupgradeneeded = () => createStores(req.result, req.transaction ?? null);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
  });

  if (!db.objectStoreNames.contains(META_STORE) && !db.objectStoreNames.contains(LEGACY_STORE)) {
    db.close();
    dbPromise = null;
    if (!allowRecreate) throw new Error(`IndexedDB stores not found`);
    await deleteDb(dbName);
    return openDb(dbName, { allowRecreate: false });
  }

  return db;
}

async function metaStoreCount(db: IDBDatabase): Promise<number> {
  if (!db.objectStoreNames.contains(META_STORE)) return 0;
  return new Promise((resolve) => {
    const tx = db.transaction(META_STORE, "readonly");
    const req = tx.objectStore(META_STORE).count();
    req.onsuccess = () => resolve(typeof req.result === "number" ? req.result : 0);
    req.onerror = () => resolve(0);
  });
}

/** Copy events from the old global DB into this user's DB once (if the user DB is empty). */
async function maybeMigrateLegacyGlobalEvents(targetDb: IDBDatabase, targetDbName: string): Promise<void> {
  if (targetDbName === LEGACY_GLOBAL_DB_NAME) return;
  if ((await metaStoreCount(targetDb)) > 0) return;

  let legacyDb: IDBDatabase;
  try {
    legacyDb = await openDb(LEGACY_GLOBAL_DB_NAME, { allowRecreate: false });
  } catch {
    return;
  }

  const legacyCount = await metaStoreCount(legacyDb);
  if (!legacyCount) {
    legacyDb.close();
    return;
  }

  const readStore = legacyDb.objectStoreNames.contains(META_STORE)
    ? META_STORE
    : legacyDb.objectStoreNames.contains(LEGACY_STORE)
      ? LEGACY_STORE
      : null;
  if (!readStore) {
    legacyDb.close();
    return;
  }

  const rows: StoredDetectionEvent[] = [];
  await new Promise<void>((resolve, reject) => {
    const readTx = legacyDb.transaction(readStore, "readonly");
    const cursorReq = readTx.objectStore(readStore).openCursor();
    cursorReq.onsuccess = () => {
      const cur = cursorReq.result as IDBCursorWithValue | null;
      if (!cur) return resolve();
      rows.push(cur.value as StoredDetectionEvent);
      cur.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error ?? new Error("Legacy event cursor failed"));
    readTx.onerror = () => reject(readTx.error ?? new Error("Legacy event read failed"));
  });

  if (rows.length) {
    await new Promise<void>((resolve, reject) => {
      const writeTx = targetDb.transaction([META_STORE, CROP_STORE], "readwrite");
      const metaSt = writeTx.objectStore(META_STORE);
      const cropSt = writeTx.objectStore(CROP_STORE);
      for (const row of rows) {
        const { cropImage, ...meta } = row;
        metaSt.put(meta as EventMeta);
        if (cropImage) cropSt.put({ id: row.id, cropImage });
      }
      writeTx.oncomplete = () => resolve();
      writeTx.onerror = () => reject(writeTx.error ?? new Error("Legacy event migration failed"));
    });
    emitChanged();
  }

  legacyDb.close();
}

async function getDb(): Promise<IDBDatabase> {
  const dbName = currentDbName();
  if (dbPromise && dbScopeName === dbName) return dbPromise;

  dbScopeName = dbName;
  dbPromise = (async () => {
    const db = await openDb(dbName);
    await maybeMigrateLegacyGlobalEvents(db, dbName);
    return db;
  })().catch((err) => {
    dbPromise = null;
    dbScopeName = null;
    throw err;
  });
  return dbPromise;
}

function emitChanged(): void {
  invalidateEventsListCache();
  try {
    window.dispatchEvent(new Event(DETECTION_EVENTS_CHANGED_EVENT));
  } catch {
    // ignore
  }
}

function readMetaFromStore(
  db: IDBDatabase,
  storeName: string,
  max: number,
): Promise<StoredDetectionEvent[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const st = tx.objectStore(storeName);
    const idx = st.index("createdAt");
    const results: StoredDetectionEvent[] = [];
    const req = idx.openCursor(null, "prev");

    req.onsuccess = () => {
      const cur = req.result as IDBCursorWithValue | null;
      if (!cur || results.length >= max) {
        resolve(results);
        return;
      }
      const row = cur.value as StoredDetectionEvent | EventMeta;
      const { cropImage: _drop, ...meta } = row as StoredDetectionEvent;
      results.push(meta as StoredDetectionEvent);
      cur.continue();
    };
    req.onerror = () => reject(req.error ?? new Error("Failed to list detection events"));
  });
}

export async function listDetectionEvents(limit?: number): Promise<StoredDetectionEvent[]> {
  const max =
    typeof limit === "number" && Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : EVENTS_LIST_DEFAULT_LIMIT;
  const db = await getDb();

  let results: StoredDetectionEvent[] = [];
  if (db.objectStoreNames.contains(META_STORE)) {
    results = await readMetaFromStore(db, META_STORE, max);
  } else if (db.objectStoreNames.contains(LEGACY_STORE)) {
    results = await readMetaFromStore(db, LEGACY_STORE, max);
  }

  setEventsListCache(results);
  return results;
}

export async function getDetectionEventCrop(id: string): Promise<Blob | null> {
  const eid = String(id || "").trim();
  if (!eid) return null;
  const db = await getDb();

  if (db.objectStoreNames.contains(CROP_STORE)) {
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(CROP_STORE, "readonly");
      const req = tx.objectStore(CROP_STORE).get(eid);
      req.onsuccess = () => {
        const row = req.result as { id: string; cropImage?: Blob } | undefined;
        resolve(row?.cropImage ?? null);
      };
      req.onerror = () => reject(req.error ?? new Error("Failed to read crop"));
    });
    if (blob) return blob;
  }

  if (db.objectStoreNames.contains(LEGACY_STORE)) {
    const row = await new Promise<StoredDetectionEvent | null>((resolve, reject) => {
      const tx = db.transaction(LEGACY_STORE, "readonly");
      const req = tx.objectStore(LEGACY_STORE).get(eid);
      req.onsuccess = () => resolve((req.result as StoredDetectionEvent) ?? null);
      req.onerror = () => reject(req.error ?? new Error("Failed to read event"));
    });
    return row?.cropImage ?? null;
  }

  return null;
}

export async function getDetectionEventById(id: string): Promise<StoredDetectionEvent | null> {
  const eid = String(id || "").trim();
  if (!eid) return null;
  const db = await getDb();

  let meta: EventMeta | null = null;
  if (db.objectStoreNames.contains(META_STORE)) {
    meta = await new Promise<EventMeta | null>((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readonly");
      const req = tx.objectStore(META_STORE).get(eid);
      req.onsuccess = () => resolve((req.result as EventMeta) ?? null);
      req.onerror = () => reject(req.error ?? new Error("Failed to read event"));
    });
  }

  if (!meta && db.objectStoreNames.contains(LEGACY_STORE)) {
    const legacy = await new Promise<StoredDetectionEvent | null>((resolve, reject) => {
      const tx = db.transaction(LEGACY_STORE, "readonly");
      const req = tx.objectStore(LEGACY_STORE).get(eid);
      req.onsuccess = () => resolve((req.result as StoredDetectionEvent) ?? null);
      req.onerror = () => reject(req.error ?? new Error("Failed to read event"));
    });
    return legacy;
  }

  if (!meta) return null;
  const cropImage = (await getDetectionEventCrop(eid)) ?? undefined;
  return { ...meta, cropImage };
}

export async function addDetectionEvent(ev: StoredDetectionEvent): Promise<void> {
  if (!ev.cropImage) throw new Error("Detection event missing cropImage");
  const { cropImage, ...meta } = ev;
  const db = await getDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([META_STORE, CROP_STORE], "readwrite");
    const metaSt = tx.objectStore(META_STORE);
    const cropSt = tx.objectStore(CROP_STORE);
    metaSt.put(meta as EventMeta);
    cropSt.put({ id: ev.id, cropImage });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to store detection event"));
  });

  void exportEventToDisk(ev).catch(() => null);
  void persistDetectionEventToDb(ev).catch(() => null);
  emitChanged();
}

export async function deleteDetectionEvent(id: string): Promise<void> {
  const eid = String(id || "").trim();
  if (!eid) return;
  const db = await getDb();
  const stores = [META_STORE, CROP_STORE].filter((s) => db.objectStoreNames.contains(s));

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores.length ? stores : LEGACY_STORE, "readwrite");
    if (db.objectStoreNames.contains(META_STORE)) tx.objectStore(META_STORE).delete(eid);
    if (db.objectStoreNames.contains(CROP_STORE)) tx.objectStore(CROP_STORE).delete(eid);
    if (db.objectStoreNames.contains(LEGACY_STORE)) tx.objectStore(LEGACY_STORE).delete(eid);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to delete detection event"));
  });
  emitChanged();
}

export async function clearAllDetectionEvents(): Promise<void> {
  const db = await getDb();
  const stores = [META_STORE, CROP_STORE, LEGACY_STORE].filter((s) => db.objectStoreNames.contains(s));

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, "readwrite");
    for (const name of stores) tx.objectStore(name).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to clear detection events"));
  });
  emitChanged();
}

export async function updateCameraDisplayNameOnEvents(cameraId: string, cameraName: string): Promise<void> {
  const cid = String(cameraId || "").trim();
  const name = String(cameraName || "").trim();
  if (!cid || !name) return;
  const db = await getDb();
  const storeName = db.objectStoreNames.contains(META_STORE) ? META_STORE : LEGACY_STORE;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const st = tx.objectStore(storeName);
    const idx = st.index("cameraId");
    const req = idx.openCursor(IDBKeyRange.only(cid));
    req.onsuccess = () => {
      const cur = req.result as IDBCursorWithValue | null;
      if (!cur) return;
      const row = cur.value as StoredDetectionEvent;
      if (row.cameraName !== name) {
        const { cropImage: _c, ...meta } = row;
        cur.update({ ...meta, cameraName: name });
      }
      cur.continue();
    };
    req.onerror = () => reject(req.error ?? new Error("Failed to update event camera names"));
    tx.oncomplete = () => {
      emitChanged();
      resolve();
    };
    tx.onerror = () => reject(tx.error ?? new Error("Transaction failed"));
  });
}

export async function countDetectionEventsByCamera(cameraId: string): Promise<number> {
  const cid = String(cameraId || "").trim();
  if (!cid) return 0;
  const db = await getDb();
  const storeName = db.objectStoreNames.contains(META_STORE) ? META_STORE : LEGACY_STORE;

  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const idx = tx.objectStore(storeName).index("cameraId");
    const req = idx.count(IDBKeyRange.only(cid));
    req.onsuccess = () => resolve(typeof req.result === "number" ? req.result : 0);
    req.onerror = () => reject(req.error ?? new Error("Failed to count detection events"));
  });
}

function resolveExportWorkspace(ev: StoredDetectionEvent): ExportWorkspaceId {
  const ws = ev.detectionWorkspace;
  if (ws === "cameras" || ws === "cameras2" || ws === "cameras3" || ws === "cameras4") return ws;
  return "cameras";
}

async function exportEventToDisk(ev: StoredDetectionEvent): Promise<void> {
  if (!ev.cropImage) return;
  const workspaceId = resolveExportWorkspace(ev);

  const root = await loadExportRootDirectoryHandle(workspaceId);
  if (root) {
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

    const jpgName = `det-${ev.createdAt}-${ev.id}.jpg`;
    const imgFile = await root.getFileHandle(jpgName, { create: true });
    {
      const w = await (imgFile as any).createWritable();
      await w.write(ev.cropImage);
      await w.close();
    }

    const jsonlFile = await root.getFileHandle("events.jsonl", { create: true });
    {
      const lineObj: any = { ...ev };
      delete lineObj.cropImage;
      lineObj.image = jpgName;
      const line = JSON.stringify(lineObj) + "\n";

      const existingFile = await jsonlFile.getFile();
      const w = await (jsonlFile as any).createWritable({ keepExistingData: true });
      try {
        await w.seek(existingFile.size);
        await w.write(line);
      } finally {
        await w.close();
      }
    }
    return;
  }

  const serverPath = await getServerExportPath(workspaceId);
  if (serverPath) {
    await exportDetectionEventViaServer(ev, workspaceId);
  }
}
