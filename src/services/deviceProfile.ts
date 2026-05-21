/**
 * Stores one device registration per MeshCentral username on this browser.
 *
 * Key: `atomo_device_profile:<normalizedUsername>` for logged-in flows.
 *
 * Legacy key `atomo_device_profile` (no suffix) is used only when there is no
 * username — e.g. onboarding registration before mesh login. It is never copied
 * onto a named user automatically (that used to make every account share one device).
 */

export type DeviceProfile = {
  serialNumber: string;
  deviceName: string;
  organizationName: string;
  email?: string;
  phone?: string;
  location?: string;
  cloudSync?: boolean;
  registeredAt: number;
};

const LEGACY_KEY = "atomo_device_profile";

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function keyedStorageKey(username: string): string {
  return `${LEGACY_KEY}:${normalizeUsername(username)}`;
}

export const DEVICE_PROFILE_CHANGED_EVENT = "atomo-forge:device-profile-changed";

function readParsed(raw: string | null): DeviceProfile | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DeviceProfile;
    if (!parsed || typeof parsed.serialNumber !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function dispatchChanged(): void {
  try {
    window.dispatchEvent(new Event(DEVICE_PROFILE_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

/** Read legacy blob only (no per-user key). */
function readLegacyProfile(): DeviceProfile | null {
  try {
    return readParsed(localStorage.getItem(LEGACY_KEY));
  } catch {
    return null;
  }
}

/**
 * @param username MeshCentral login name (normalized by callers). Pass null/undefined to use legacy-only storage (onboarding without login).
 */
export function getDeviceProfile(username?: string | null): DeviceProfile | null {
  try {
    const u = username != null && String(username).trim() !== "" ? normalizeUsername(String(username)) : null;
    if (u) {
      return readParsed(localStorage.getItem(keyedStorageKey(u)));
    }
    return readLegacyProfile();
  } catch {
    return null;
  }
}

export function setDeviceProfile(username: string | null | undefined, profile: DeviceProfile): void {
  try {
    const u = username != null && String(username).trim() !== "" ? normalizeUsername(String(username)) : null;
    const payload = JSON.stringify(profile);
    if (u) {
      localStorage.setItem(keyedStorageKey(u), payload);
    } else {
      localStorage.setItem(LEGACY_KEY, payload);
    }
    dispatchChanged();
  } catch {
    // ignore quota / disabled storage
  }
}

export function clearDeviceProfile(username?: string | null): void {
  try {
    const u = username != null && String(username).trim() !== "" ? normalizeUsername(String(username)) : null;
    if (u) {
      localStorage.removeItem(keyedStorageKey(u));
    } else {
      localStorage.removeItem(LEGACY_KEY);
    }
    dispatchChanged();
  } catch {
    /* ignore */
  }
}

export function hasDeviceProfile(username?: string | null): boolean {
  return getDeviceProfile(username) != null;
}
