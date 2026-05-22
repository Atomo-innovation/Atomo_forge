import { authApiUrl, readForgeApiJson } from "@/services/authApiUrl";

export const ELECTRON_LOCAL_HTTP = "http://electron.local";

export type DevNetworkInfo = {
  ok?: boolean;
  lanIp: string | null;
  lanHttpUrl: string | null;
  mdnsActive?: boolean;
  electronLocalHttpUrl?: string;
  otherDevicesUrl: string | null;
  localHttpsUrl: string;
  electronLocalNote: string;
};

/** URL for other devices on the same Wi‑Fi (electron.local when mDNS is on). */
export function getOtherDevicesUrl(): string {
  const fromEnv = import.meta.env.VITE_OTHER_DEVICES_URL as string | undefined;
  if (fromEnv?.trim()) return fromEnv.trim().replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location.hostname === "electron.local") {
    return ELECTRON_LOCAL_HTTP;
  }
  return getClientLanHttpUrl() || ELECTRON_LOCAL_HTTP;
}

/** Built-in fallback when auth API is not up yet (e.g. during first paint). */
export function getClientLanHttpUrl(): string {
  const fromEnv = import.meta.env.VITE_LAN_HTTP_URL as string | undefined;
  if (fromEnv?.trim()) return fromEnv.trim().replace(/\/$/, "");
  if (typeof window !== "undefined") {
    const { hostname, protocol, port } = window.location;
    if (hostname === "electron.local" && protocol === "http:") {
      return ELECTRON_LOCAL_HTTP;
    }
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) && protocol === "http:") {
      return port ? `http://${hostname}:${port}` : `http://${hostname}`;
    }
  }
  return "";
}

export async function fetchDevNetworkInfo(): Promise<DevNetworkInfo | null> {
  try {
    const res = await fetch(authApiUrl("/api/dev/network-info"));
    const data = await readForgeApiJson<DevNetworkInfo>(res);
    if (!data) return null;
    return data;
  } catch {
    return null;
  }
}
