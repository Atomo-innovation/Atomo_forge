import { defineConfig, loadEnv, createLogger } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
import net from "node:net";
import { createRequire } from "node:module";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import type { Plugin } from "vite";
import { componentTagger } from "lovable-tagger";

const __viteRootDir = path.dirname(fileURLToPath(import.meta.url));

function detectLanIPv4(): string | undefined {
  const fromEnv = process.env.FORGE_LAN_IP || process.env.VITE_LAN_HTTP_URL?.replace(/^https?:\/\//, "").split("/")[0];
  if (fromEnv && /^\d{1,3}(\.\d{1,3}){3}$/.test(fromEnv)) return fromEnv;
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    if (/^(lo|docker|br-|veth|virbr)/i.test(name)) continue;
    for (const addr of ifaces[name] || []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return undefined;
}
const twinRequire = createRequire(import.meta.url);

/** Same `.env` + `.env.local` merge as the twin launcher so Vite’s proxy targets the correct port. */
function hydrateForgeDotEnv(): void {
  try {
    twinRequire(path.join(__viteRootDir, "load-env.cjs"));
  } catch {
    /* ignore missing load-env.cjs */
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function tcpOpen(port: number, timeoutMs = 450): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => finish(true));
    socket.on("timeout", () => finish(false));
    socket.on("error", () => finish(false));
  });
}

async function waitForTwinListening(port: number, maxMs: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    // eslint-disable-next-line no-await-in-loop
    if (await tcpOpen(port)) return true;
    // eslint-disable-next-line no-await-in-loop
    await sleep(350);
  }
  return false;
}

/** If npm run dev’s twin starts late (or someone runs bare `vite`), bring up the twin listener. */
function pdeuTwinAutoStartPlugin(repoRoot: string, port: number): Plugin {
  let child: ChildProcess | undefined;
  let weSpawned = false;
  let cleaned = false;

  return {
    name: "pdeu-twin-auto-start",
    apply: (_, env) => env.command === "serve" && !env.isPreview,
    configureServer(server) {
      if (process.env.SKIP_VITE_AUTO_TWIN === "1" || process.env.SKIP_PDEU_TWIN === "1") {
        return undefined;
      }
      const launcher = path.join(repoRoot, "scripts", "start-pdeu-digital-twin.cjs");

      const bootstrap = async () => {
        const warmed = await waitForTwinListening(port, 90_000);
        if (warmed || cleaned) {
          if (!cleaned && warmed)
            console.info(`[pdeu-twin] backend ready on 127.0.0.1:${port}`);
          return;
        }
        console.warn(
          `[pdeu-twin] nothing on 127.0.0.1:${port} after 90s — starting twin via ${launcher}`,
        );
        try {
          child = spawn(process.execPath, [launcher], {
            cwd: repoRoot,
            env: {
              ...process.env,
              TWIN_HTTP_PORT: String(port),
              MQTT_DISABLED: process.env.MQTT_DISABLED ?? "1",
            },
            stdio: "inherit",
          });
          weSpawned = true;
          child.on("exit", (code, signal) => {
            if (!weSpawned || cleaned) return;
            console.warn(`[pdeu-twin] process exited code=${code} signal=${signal ?? "none"}`);
          });
        } catch (e) {
          console.warn("[pdeu-twin] spawn failed:", e);
        }
      };

      server.httpServer?.once("listening", () => {
        void bootstrap();
      });

      const killChild = () => {
        cleaned = true;
        if (!weSpawned || !child?.pid) return;
        try {
          console.info("[pdeu-twin] stopping twin child");
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      };
      process.on("exit", killChild);

      return () => {
        process.off("exit", killChild);
        killChild();
      };
    },
  };
}

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

/** Remind devs of this-PC vs LAN URLs when the dev server starts. */
function forgeDevUrlBannerPlugin(
  host: string,
  port: number,
  lanHttpUrl?: string,
  boardPlainHttp?: boolean,
) {
  const scheme = boardPlainHttp ? "http" : "https";
  const url = `${scheme}://${host}:${port}/`;
  return {
    name: "forge-dev-url-banner",
    configureServer(server: { httpServer?: { once: (e: string, fn: () => void) => void } }) {
      server.httpServer?.once("listening", () => {
        if (boardPlainHttp) {
          console.info("\n[forge] Board browser URL: http://electron.local/");
          console.info(`[forge] Direct Vite: ${url}`);
        } else {
          console.info(`\n[forge] This PC: ${url}`);
        }
        const other =
          process.env.FORGE_OTHER_DEVICES_URL ||
          process.env.VITE_OTHER_DEVICES_URL ||
          (lanHttpUrl ? `http://electron.local (mDNS) or ${lanHttpUrl}` : "");
        if (other) {
          console.info(`[forge] Other devices (same Wi‑Fi): ${other}`);
          if (!boardPlainHttp) {
            console.info("[forge] They should type http://electron.local (run npm run lan:setup once if that fails).");
          }
        }
        if (boardPlainHttp) {
          console.info("[forge] If the browser shows 502, run: npm run board:caddy-sync\n");
        } else {
          console.info("[forge] https://electron.local/ needs Caddy on :443 — run: npm run caddy:start\n");
        }
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  hydrateForgeDotEnv();
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = "http://localhost:3003";
  /** Match Vite: `.env.development*` overrides `.env` / `.env.local` set by load-env.cjs. */
  const twinHttpPort =
    Number(env.TWIN_HTTP_PORT || process.env.TWIN_HTTP_PORT || 3000) || 3000;
  const devHost = env.VITE_DEV_HOST || "electron.local";
  const devPort = Number(env.VITE_DEV_PORT || 8443);
  const lanIp = detectLanIPv4();
  const lanHttpUrl =
    (env.VITE_LAN_HTTP_URL || process.env.FORGE_LAN_HTTP_URL || (lanIp ? `http://${lanIp}` : "")).replace(
      /\/$/,
      "",
    ) || undefined;
  const extraAllowedHosts = (env.VITE_ALLOWED_HOSTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const previewPort = Number(env.VITE_PREVIEW_PORT || 4173);

  const boardPlainHttp =
    env.FORGE_VITE_PLAIN_HTTP === "1" || process.env.FORGE_VITE_PLAIN_HTTP === "1";
  const devHttps = boardPlainHttp
    ? undefined
    : {
        key: fs.readFileSync(path.resolve(__viteRootDir, "./devcert/key.pem")),
        cert: fs.readFileSync(path.resolve(__viteRootDir, "./devcert/cert.pem")),
      };

  /** Same routes on dev server and preview (`vite preview`) so `/api` is never served as SPA HTML. */
  const forgeDevProxy = {
    "/api": { target: apiTarget, changeOrigin: true },
    "/asnn": { target: apiTarget, changeOrigin: true, ws: true },
    "/pdeu-ws-fire": {
      target: "http://127.0.0.1:8080",
      changeOrigin: true,
      ws: true,
    },
    "/pdeu-ws-person": {
      target: "http://127.0.0.1:8081",
      changeOrigin: true,
      ws: true,
    },
    "/pdeu-twin": {
      target: `http://127.0.0.1:${twinHttpPort}`,
      changeOrigin: true,
      ws: true,
      timeout: 0,
      proxyTimeout: 0,
      rewrite: (p: string) => (p.replace(/^\/pdeu-twin/, "") || "/"),
    },
  };

  return ({
    define: {
      "import.meta.env.VITE_FORGE_TWIN_PROXY_PORT": JSON.stringify(String(twinHttpPort)),
      "import.meta.env.VITE_LAN_HTTP_URL": JSON.stringify(lanHttpUrl ?? ""),
      "import.meta.env.VITE_OTHER_DEVICES_URL": JSON.stringify(
        process.env.VITE_OTHER_DEVICES_URL || process.env.FORGE_OTHER_DEVICES_URL || "",
      ),
    },
  customLogger: makeQuietLogger(),
  server: {
    // Bind on all interfaces, but allow a friendly local hostname like
    // https://electron.local:8443 (add it to /etc/hosts).
    host: true,
    port: devPort,
    strictPort: false,
    // Allow access via electron.local and via LAN IP/hostname for other devices.
    // true = allow phones/tablets hitting http://<LAN-IP> via Caddy :80
    allowedHosts:
      env.FORGE_ALLOWED_HOSTS_STRICT === "1"
        ? Array.from(new Set([devHost, lanIp, env.FORGE_LAN_IP, ...extraAllowedHosts].filter(Boolean)))
        : true,
    https: devHttps,
    // No fixed origin — works for this PC (electron.local:8443) and LAN (http://<IP> via Caddy :80).
    open:
      env.FORGE_DEV_OPEN === "0"
        ? false
        : env.FORGE_DEV_OPEN_URL ||
          (env.FORGE_OPEN_NO_PORT === "1"
            ? `http://${devHost}/dashboard`
            : `${boardPlainHttp ? "http" : "https"}://${devHost}:${devPort}/`),
    // Use the browser URL for HMR (443 via Caddy, :80 LAN, or :8443 direct). Forcing
    // host=electron.local + clientPort=8443 breaks WS when the page is opened on :443
    // and causes endless full-page reloads.
    hmr:
      env.FORGE_HMR === "0"
        ? false
        : {
            overlay: false,
            ...(env.FORGE_HMR_CLIENT_PORT
              ? { clientPort: Number(env.FORGE_HMR_CLIENT_PORT) }
              : {}),
          },
    proxy: forgeDevProxy,
  },
  preview: {
    host: true,
    port: previewPort,
    strictPort: false,
    allowedHosts: Array.from(new Set([devHost, ...extraAllowedHosts])),
    https: devHttps,
    proxy: forgeDevProxy,
  },
  plugins: [
    forgeDevUrlBannerPlugin(devHost, devPort, lanHttpUrl, boardPlainHttp),
    pdeuTwinAutoStartPlugin(__viteRootDir, twinHttpPort),
    react(),
    mode === "development" && env.FORGE_LOVABLE_TAGGER === "1" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__viteRootDir, "./src"),
    },
  },
});
});
