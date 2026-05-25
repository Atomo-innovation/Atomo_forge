/**
 * Stable camera ID mapping by input fingerprint.
 *
 * Why: previously camera IDs were `Date.now()`. If you delete + re-add a camera,
 * it gets a new ID, and older events can't reliably map to the same camera/model.
 *
 * Fingerprints:
 * - RTSP: `rtsp|<rtspUrl>`
 * - USB/CSI: `<type>|<device>` (e.g. usb|usb:0)
 */

import { userScopedLocalStorageKey } from "@/services/userScopedStorage";

const KEY = "atomo-forge:camera-id-by-fingerprint:v1";

function storageKey(): string {
  return userScopedLocalStorageKey(KEY);
}

function readMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function writeMap(next: Record<string, string>): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function getCameraFingerprint(args: { type: "usb" | "csi" | "rtsp"; rtspUrl?: string; device?: string }): string | null {
  const t = args.type;
  if (t === "rtsp") {
    const u = (args.rtspUrl ?? "").trim();
    return u ? `rtsp|${u}` : null;
  }
  const d = (args.device ?? "").trim();
  return d ? `${t}|${d}` : null;
}

export function getOrCreateStableCameraId(fingerprint: string): string {
  const fp = String(fingerprint || "").trim();
  const all = readMap();
  const existing = all[fp];
  if (existing && typeof existing === "string") return existing;

  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  all[fp] = id;
  writeMap(all);
  return id;
}

export function clearCameraIdMap(): void {
  try {
    localStorage.removeItem(storageKey());
  } catch {
    // ignore
  }
}

