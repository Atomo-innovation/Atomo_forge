import { readPersistedSession } from "@/services/authSession";

/** Storage / IndexedDB scope when no Mesh username is in the session. */
export const ANONYMOUS_USER_SCOPE = "__anonymous__";

let activeForgeUsername: string | null = null;
const scopeListeners = new Set<() => void>();

export function normalizeForgeUsername(username: string | null | undefined): string | null {
  if (username == null) return null;
  const s = String(username).trim().toLowerCase();
  return s === "" ? null : s;
}

function scopeSegment(username: string | null | undefined): string {
  return normalizeForgeUsername(username) ?? ANONYMOUS_USER_SCOPE;
}

/** Current MeshCentral user for browser-persisted Forge data (cameras, events, layout). */
export function getActiveForgeUsername(): string | null {
  return activeForgeUsername;
}

export function setActiveForgeUsername(username: string | null | undefined): void {
  const next = normalizeForgeUsername(username);
  if (next === activeForgeUsername) return;
  activeForgeUsername = next;
  for (const listener of scopeListeners) {
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
}

export function onForgeUserScopeChanged(listener: () => void): () => void {
  scopeListeners.add(listener);
  return () => scopeListeners.delete(listener);
}

export function userScopedLocalStorageKey(baseKey: string, username?: string | null): string {
  return `${baseKey}:${scopeSegment(username ?? activeForgeUsername)}`;
}

/** Separate IndexedDB per user so detection events never leak across accounts. */
export function userScopedDbName(baseName: string, username?: string | null): string {
  const seg = scopeSegment(username ?? activeForgeUsername);
  const safe = seg.replace(/[^a-z0-9._-]/g, "_");
  return `${baseName}--${safe}`;
}

// Hydrate scope before React mounts (reload on /dashboard).
setActiveForgeUsername(readPersistedSession()?.username ?? null);
