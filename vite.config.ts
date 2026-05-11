import { defineConfig, loadEnv, createLogger } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
import { componentTagger } from "lovable-tagger";

// Filter only the harmless dev-time TCP-race messages from the WS proxy
// (browser closes a /universal WS while Vite is still mid-write to upstream).
// Real proxy errors with different messages still propagate.
const NOISY_DEV_LOG_PATTERNS: RegExp[] = [
  /ws proxy socket error/i,
  /This socket has been ended by the other party/i,
  /writeAfterFIN/i,
  /ERR_STREAM_WRITE_AFTER_END/i,
  /\bEPIPE\b/,
  /\bECONNRESET\b/,
];

function makeQuietLogger() {
  const base = createLogger();
  const isNoisy = (msg: unknown) => {
    const s = typeof msg === "string" ? msg : String(msg ?? "");
    return NOISY_DEV_LOG_PATTERNS.some((p) => p.test(s));
  };
  return {
    ...base,
    error(msg: string, opts?: Parameters<typeof base.error>[1]) {
      if (isNoisy(msg)) return;
      base.error(msg, opts);
    },
    warn(msg: string, opts?: Parameters<typeof base.warn>[1]) {
      if (isNoisy(msg)) return;
      base.warn(msg, opts);
    },
  } as ReturnType<typeof createLogger>;
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = "http://localhost:3003";
  const devHost = env.VITE_DEV_HOST || "electron.local";
  const devPort = Number(env.VITE_DEV_PORT || 8443);
  const extraAllowedHosts = (env.VITE_ALLOWED_HOSTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return ({
  customLogger: makeQuietLogger(),
  server: {
    // Bind on all interfaces, but allow a friendly local hostname like
    // https://electron.local:8443 (add it to /etc/hosts).
    host: true,
    port: devPort,
    strictPort: false,
    // Allow access via electron.local and via LAN IP/hostname for other devices.
    allowedHosts: Array.from(new Set([devHost, ...extraAllowedHosts])),
    https: {
      key: fs.readFileSync(path.resolve(__dirname, "./devcert/key.pem")),
      cert: fs.readFileSync(path.resolve(__dirname, "./devcert/cert.pem")),
    },
    origin: `https://${devHost}:${devPort}`,
    hmr: {
      host: devHost,
      clientPort: devPort,
      overlay: false,
    },
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      // Universal backend is now embedded in the Forge API process.
      "/universal": { target: apiTarget, changeOrigin: true, ws: true },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
});
