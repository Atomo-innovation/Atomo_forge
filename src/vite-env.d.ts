/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Injected in vite.config (twin proxy target port). */
  readonly VITE_FORGE_TWIN_PROXY_PORT: string;
}
