/**
 * Auth API base (login, device registration, MeshCentral helpers).
 *
 * • Dev with `npm run dev`: leave unset — Vite proxies `/api` and `/universal` to the auth-server port.
 * • Electron / static preview / odd hosts: set `VITE_AUTH_API_ORIGIN=http://127.0.0.1:3003` (or LAN URL).
 */

export function getAuthApiOrigin(): string {
  const v = import.meta.env.VITE_AUTH_API_ORIGIN as string | undefined;
  if (v != null && String(v).trim() !== "") {
    return String(v).trim().replace(/\/$/, "");
  }
  return "";
}

/** Prefix `/api/...` (and MeshCentral routes under `/api`) with explicit origin when needed. */
export function authApiUrl(path: string): string {
  const base = getAuthApiOrigin();
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

/** Read JSON body; returns null if body is HTML or invalid JSON (common when /api is not proxied). */
export async function readForgeApiJson<T extends Record<string, unknown> = Record<string, unknown>>(r: Response): Promise<T | null> {
  const text = await r.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
