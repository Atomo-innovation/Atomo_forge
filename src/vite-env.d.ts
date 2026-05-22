/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Injected in vite.config (twin proxy target port). */
  readonly VITE_FORGE_TWIN_PROXY_PORT: string;
  /** http://<LAN-IP> for other devices on the same Wi‑Fi (dev only). */
  readonly VITE_LAN_HTTP_URL: string;
  /** http://electron.local when mDNS is active (dev only). */
  readonly VITE_OTHER_DEVICES_URL: string;
}
