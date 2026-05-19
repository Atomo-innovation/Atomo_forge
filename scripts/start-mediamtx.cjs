#!/usr/bin/env node
/**
 * Start MediaMTX (WebRTC/WHEP on :8889) from the PDEU digital twin folder.
 * Used by `npm run dev`. Twin path is resolved the same way as start-pdeu-digital-twin.cjs.
 *
 * Skip: FORGE_SKIP_MEDIAMTX=1 or MEDIAMTX_SKIP=1 (keeps concurrently slot alive).
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { resolvePdeuDigitalTwinDir } = require("./resolve-pdeu-digital-twin-dir.cjs");

function skipRequested() {
  const raw = process.env.FORGE_SKIP_MEDIAMTX || process.env.MEDIAMTX_SKIP || "";
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function idleForever() {
  setInterval(() => {}, 2 ** 30);
}

function main() {
  if (skipRequested()) {
    console.log("[mediamtx] Skipped (FORGE_SKIP_MEDIAMTX / MEDIAMTX_SKIP). Idle slot for npm run dev.");
    idleForever();
    return;
  }

  const repoRoot = path.join(__dirname, "..");
  const twinDir = resolvePdeuDigitalTwinDir(repoRoot);
  if (!twinDir) {
    console.error(
      "[mediamtx] Could not locate digital twin folder (need mediamtx binary + mediamtx.yml next to server.js).",
    );
    process.exit(1);
  }

  const binaryName = process.platform === "win32" ? "mediamtx.exe" : "mediamtx";
  const binary = path.join(twinDir, binaryName);
  const config = path.join(twinDir, "mediamtx.yml");

  if (!fs.existsSync(binary)) {
    console.error("[mediamtx] Binary not found:", binary);
    process.exit(1);
  }
  if (!fs.existsSync(config)) {
    console.error("[mediamtx] Config not found:", config);
    process.exit(1);
  }

  console.log("[mediamtx] starting:", binary);
  console.log("[mediamtx] config:", config);
  console.log("[mediamtx] WHEP endpoints: http://<host>:8889/workstation/whep and /pdeu/whep");

  const child = spawn(binary, [config], {
    cwd: twinDir,
    stdio: "inherit",
    env: process.env,
    windowsHide: false,
  });

  child.on("error", (err) => {
    console.error("[mediamtx] failed to start:", err.message);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

main();
