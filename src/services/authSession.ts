/**
 * Forge client session — stored in localStorage so reloads, new tabs, and
 * typing `/dashboard` keep you in the app until you log out. API calls still
 * use server-side auth as configured.
 */

const LEGACY_FLAG = "atomo_logged_in";
const SESSION_KEY = "atomo-forge:session:v1";
/** Tab-scoped MeshCentral web password from /login (avoid re-prompting on /register). */
const MESH_CREDS_KEY = "atomo-forge:mesh-creds:v1";

type StoredSession = { username: string | null };

function legacyCleanup(): void {
  try {
    localStorage.removeItem(LEGACY_FLAG);
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.removeItem(LEGACY_FLAG);
  } catch {
    /* ignore */
  }
}

/** One-time move from earlier sessionStorage-only builds. */
function migrateSessionFromSessionStorage(): void {
  try {
    const fromTab = sessionStorage.getItem(SESSION_KEY);
    if (!fromTab) return;
    if (!localStorage.getItem(SESSION_KEY)) {
      localStorage.setItem(SESSION_KEY, fromTab);
    }
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function normalizeStoredUsername(meshUsername?: string | null): string | null {
  if (meshUsername == null) return null;
  const s = String(meshUsername).trim().toLowerCase();
  return s === "" ? null : s;
}

/**
 * Persist who is logged in for this Forge UI session (`null` = legacy onboarding
 * device profile without a Mesh username in this session blob).
 */
export function persistForgeSession(meshUsername?: string | null): void {
  legacyCleanup();
  migrateSessionFromSessionStorage();
  try {
    const username = normalizeStoredUsername(meshUsername ?? null);
    const payload: StoredSession = { username };
    const encoded = JSON.stringify(payload);
    localStorage.setItem(SESSION_KEY, encoded);
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  } catch {
    /* private mode / quota */
  }
}

export function clearForgeSession(): void {
  legacyCleanup();
  clearMeshLoginCredential();
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Remember MeshCentral web password for this browser tab after Forge login. */
export function persistMeshLoginCredential(meshUsername: string, password: string): void {
  const username = normalizeStoredUsername(meshUsername);
  if (!username || !password) return;
  try {
    sessionStorage.setItem(MESH_CREDS_KEY, JSON.stringify({ username, password }));
  } catch {
    /* private mode / quota */
  }
}

/** Credentials saved at login for the current tab, if any. */
export function readMeshLoginCredential(): { username: string; password: string } | null {
  try {
    const raw = sessionStorage.getItem(MESH_CREDS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const username = normalizeStoredUsername((parsed as { username?: unknown }).username as string);
    const password = String((parsed as { password?: unknown }).password ?? "");
    if (!username || !password) return null;
    return { username, password };
  } catch {
    return null;
  }
}

export function clearMeshLoginCredential(): void {
  try {
    sessionStorage.removeItem(MESH_CREDS_KEY);
  } catch {
    /* ignore */
  }
}

/** `null` if the user must go through `/login` (or onboarding) again. */
export function readPersistedSession(): StoredSession | null {
  legacyCleanup();
  migrateSessionFromSessionStorage();
  try {
    let raw = localStorage.getItem(SESSION_KEY);
    if (!raw) {
      raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        try {
          localStorage.setItem(SESSION_KEY, raw);
        } catch {
          /* ignore */
        }
      }
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || !("username" in parsed)) return null;
    const u = (parsed as StoredSession).username;
    const username =
      u === undefined || u === null
        ? null
        : typeof u === "string"
          ? normalizeStoredUsername(u)
          : null;
    return { username };
  } catch {
    return null;
  }
}

/** @deprecated Use {@link readPersistedSession} — kept so imports don't break silently. */
export function readLoggedIn(): boolean {
  return readPersistedSession() !== null;
}

/** @deprecated No-op; use {@link persistForgeSession} / {@link clearForgeSession}. */
export function setLoggedIn(_value: boolean): void {
  void _value;
}
