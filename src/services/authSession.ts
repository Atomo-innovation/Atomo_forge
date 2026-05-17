/**
 * Forge client session — stored in localStorage so reloads, new tabs, and
 * typing `/dashboard` keep you in the app until you log out. API calls still
 * use server-side auth as configured.
 */

const LEGACY_FLAG = "atomo_logged_in";
const SESSION_KEY = "atomo-forge:session:v1";

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
