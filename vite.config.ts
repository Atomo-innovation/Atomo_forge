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

  return ({
  customLogger: makeQuietLogger(),
  server: {
    host: "::",
    port: 8443,
    strictPort: false,
    https: {
      key: fs.readFileSync(path.resolve(__dirname, "./devcert/key.pem")),
      cert: fs.readFileSync(path.resolve(__dirname, "./devcert/cert.pem")),
    },
    hmr: {
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
