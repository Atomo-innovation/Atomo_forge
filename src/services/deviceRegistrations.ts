import { authApiUrl, getAuthApiOrigin, readForgeApiJson } from "@/services/authApiUrl";

import {
  getDeviceProfile,
  setDeviceProfile,
  type DeviceProfile,
} from "@/services/deviceProfile";

export type RegistrationRow = {
  serialNumber: string;
  meshUsername: string | null;
  deviceName: string;
  organizationName: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  cloudSync: number | boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ByEmail = { email: string; deviceCount: number };

export function normalizeRegistrationRow(raw: unknown): RegistrationRow {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sn = r.serialNumber ?? r.serial_number;
  const dn = r.deviceName ?? r.device_name;
  const on = r.organizationName ?? r.organization_name;
  const mu = r.meshUsername ?? r.mesh_username;
  const cs = r.cloudSync ?? r.cloud_sync;
  const ca = r.createdAt ?? r.created_at;
  const ua = r.updatedAt ?? r.updated_at;
  return {
    serialNumber: typeof sn === "string" ? sn : String(sn ?? ""),
    meshUsername: mu == null ? null : String(mu),
    deviceName:
      typeof dn === "string" && dn.trim() !== "" ? dn : typeof dn === "string" ? dn : String(dn ?? "—"),
    organizationName:
      typeof on === "string" && on.trim() !== "" ? on : typeof on === "string" ? on : String(on ?? "—"),
    email: r.email == null ? null : String(r.email),
    phone: r.phone == null ? null : String(r.phone),
    location: r.location == null ? null : String(r.location),
    cloudSync: cs as RegistrationRow["cloudSync"],
    createdAt: ca == null ? null : String(ca),
    updatedAt: ua == null ? null : String(ua),
  };
}

export type FetchRegistrationsOk = {
  ok: true;
  devices: RegistrationRow[];
  byEmail: ByEmail[];
  schemaNote?: string;
  migrationNeeded?: boolean;
  hint?: string;
};

export type FetchRegistrationsErr = {
  ok: false;
  error: string;
};

export async function fetchDeviceRegistrations(
  meshUsername: string,
  profileEmail?: string | null,
): Promise<FetchRegistrationsOk | FetchRegistrationsErr> {
  const q = new URLSearchParams({ meshUsername });
  if (profileEmail) q.set("profileEmail", profileEmail);
  const url = authApiUrl(`/api/devices/registrations?${q.toString()}`);
  let r: Response;
  try {
    r = await fetch(url);
  } catch {
    return { ok: false, error: "Network error loading registrations" };
  }

  const j = await readForgeApiJson<{
    ok?: boolean;
    error?: string;
    hint?: string;
    devices?: unknown;
    byEmail?: unknown;
    migrationNeeded?: boolean;
    schemaNote?: string;
  }>(r);

  const success = r.ok && j != null && j.ok === true;
  if (!success) {
    const parts = [j?.error, j?.hint].filter((x: unknown) => typeof x === "string" && String(x).trim() !== "");
    let msg = parts.length ? parts.join(" ") : "";
    if (!msg) {
      if (j == null) {
        msg =
          "The server did not return JSON (often the browser loaded HTML instead of the API). Start `node auth-server.cjs` on port 3003 and use `npm run dev` so /api is proxied. For Electron builds without the proxy, set VITE_AUTH_API_ORIGIN=http://127.0.0.1:3003 in .env and rebuild.";
      } else if (!r.ok) {
        msg = `Request failed (HTTP ${r.status}). Check auth-server and MySQL.`;
      } else {
        msg = "Could not load registrations";
      }
    }
    if (!getAuthApiOrigin() && typeof window !== "undefined" && window.location.port && window.location.port !== "3003") {
      msg += " If this persists, set VITE_AUTH_API_ORIGIN to your auth-server base URL.";
    }
    return { ok: false, error: msg };
  }

  return {
    ok: true,
    devices: (Array.isArray(j.devices) ? j.devices : []).map(normalizeRegistrationRow),
    byEmail: Array.isArray(j.byEmail) ? j.byEmail : [],
    schemaNote: typeof j.schemaNote === "string" ? j.schemaNote : undefined,
    migrationNeeded: j.migrationNeeded === true,
    hint: typeof j.hint === "string" ? j.hint : undefined,
  };
}

/** Load the account's single device from MySQL into local profile (if present). */
export async function hydrateDeviceProfileFromServer(
  meshUsername: string,
): Promise<boolean> {
  const u = meshUsername.trim().toLowerCase();
  if (!u) return false;
  if (getDeviceProfile(u)) return true;
  const result = await fetchDeviceRegistrations(u);
  if (!result.ok || result.devices.length === 0) return false;
  setDeviceProfile(u, deviceProfileFromRegistrationRow(result.devices[0]));
  return true;
}

export function deviceProfileFromRegistrationRow(d: RegistrationRow): DeviceProfile {
  const emailNorm = d.email?.trim() ? d.email.trim().toLowerCase() : undefined;
  return {
    serialNumber: d.serialNumber.trim(),
    deviceName: d.deviceName.trim(),
    organizationName: d.organizationName.trim(),
    email: emailNorm,
    phone: d.phone?.trim() || undefined,
    location: d.location?.trim() || undefined,
    cloudSync: d.cloudSync === 1 || d.cloudSync === true,
    registeredAt: Date.now(),
  };
}
