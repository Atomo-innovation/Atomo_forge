#!/usr/bin/env node
/**
 * Start PDEU digital twin HTTP server (reads TWIN_HTTP_PORT from .env / .env.local via load-env).
 * Cross-platform — use from package.json (`npm run dev`).
 */
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { resolvePdeuDigitalTwinDir } = require("./resolve-pdeu-digital-twin-dir.cjs");

require(path.join(__dirname, "..", "load-env.cjs"));

const repoRoot = path.join(__dirname, "..");

/** Mirror Vite’s `.env.development` / `.env.development.local` so `server.js` port matches proxy. */
function applyEnvDevelopmentFiles() {
  const applyLines = (absPath) => {
    if (!fs.existsSync(absPath)) return;
    const lines = fs.readFileSync(absPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key) process.env[key] = val;
    }
  };
  applyLines(path.join(repoRoot, ".env.development"));
  applyLines(path.join(repoRoot, ".env.development.local"));
}

applyEnvDevelopmentFiles();

function findTwinDir() {
  const d = resolvePdeuDigitalTwinDir(repoRoot);
  return d || null;
}

function main() {
  const installer = path.join(repoRoot, "scripts", "install-pdeu-digital-twin.cjs");
  const ir = spawnSync(process.execPath, [installer], { stdio: "inherit", cwd: repoRoot });
  if (ir.status !== 0) process.exit(ir.status ?? 1);

  const twinDir = findTwinDir();
  if (!twinDir) {
    console.error(
      "[twin] Could not locate digital twin (final_*/pdeu_digitaltwin/pdeu_digitaltwin or repo-root pdeu_digitaltwin).",
    );
    process.exit(1);
  }

  const env = { ...process.env, MQTT_DISABLED: process.env.MQTT_DISABLED || "1" };
  console.log("[twin] starting from:", twinDir);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: twinDir,
    stdio: "inherit",
    env,
    windowsHide: false,
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

main();
