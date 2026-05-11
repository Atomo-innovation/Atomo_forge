/**
 * Stores the device registration details locally so the dashboard / top bar
 * can display them, and Login can decide whether to send the user to /register
 * (first run) or directly to /dashboard (already registered).
 *
 * Source of truth on the server is MySQL (`atomo_registered_devices`); this
 * is a local cache populated on a successful POST /api/devices/register.
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

const KEY = "atomo_device_profile";

export const DEVICE_PROFILE_CHANGED_EVENT = "atomo-forge:device-profile-changed";

export function getDeviceProfile(): DeviceProfile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeviceProfile;
    if (!parsed || typeof parsed.serialNumber !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setDeviceProfile(p: DeviceProfile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
    window.dispatchEvent(new Event(DEVICE_PROFILE_CHANGED_EVENT));
  } catch {
    // ignore quota / disabled storage
  }
}

export function clearDeviceProfile(): void {
  try {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(DEVICE_PROFILE_CHANGED_EVENT));
  } catch {
    // ignore
  }
}

export function hasDeviceProfile(): boolean {
  return getDeviceProfile() != null;
}
