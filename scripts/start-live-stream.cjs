#!/usr/bin/env node
/**
 * Face recognition stack: live_stream/server.js (MediaMTX + face-events API).
 * Proxied in dev as /face-stream → http://127.0.0.1:LIVE_STREAM_PORT
 *
 * Skip: FORGE_SKIP_FACE_STREAM=1
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function skipRequested() {
  const raw = process.env.FORGE_SKIP_FACE_STREAM || process.env.FACE_STREAM_SKIP || "";
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function idleForever() {
  setInterval(() => {}, 2 ** 30);
}

function main() {
  if (skipRequested()) {
    console.log("[face-stream] Skipped (FORGE_SKIP_FACE_STREAM). Idle slot for npm run dev.");
    idleForever();
    return;
  }

  const repoRoot = path.join(__dirname, "..");
  const liveDir = path.join(repoRoot, "live_stream");
  const entry = path.join(liveDir, "server.js");
  if (!fs.existsSync(entry)) {
    console.log("[face-stream] live_stream/server.js not found — skipped.");
    idleForever();
    return;
  }

  const port = Number(process.env.LIVE_STREAM_PORT || 3010) || 3010;
  process.env.LIVE_STREAM_PORT = String(port);

  console.log(`[face-stream] starting on http://127.0.0.1:${port} (proxy: /face-stream)`);

  const child = spawn(process.execPath, [entry], {
    cwd: liveDir,
    stdio: "inherit",
    env: {
      ...process.env,
      LIVE_STREAM_PORT: String(port),
      NODE_ENV: process.env.NODE_ENV || "development",
    },
    windowsHide: false,
  });

  child.on("error", (err) => {
    console.error("[face-stream] failed to start:", err.message);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

main();
