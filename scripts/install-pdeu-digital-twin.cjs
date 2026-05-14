/**
 * Install npm dependencies for the PDEU digital twin subfolder.
 * - Run automatically after root `npm install` via package.json "postinstall".
 * - Run manually: `npm run twin:install`
 * - Set SKIP_PDEU_TWIN_INSTALL=1 to skip (e.g. CI without the twin folder).
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function findTwinDir(repoRoot) {
  const candidates = ["pdeu_digitaltwin ", "pdeu_digitaltwin"];
  for (const name of candidates) {
    const dir = path.join(repoRoot, name);
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
  }
  return null;
}

function needsInstall(twinDir) {
  const nm = path.join(twinDir, "node_modules");
  const markers = ["three", "express", "ws", "mqtt", "es-module-shims"];
  if (!fs.existsSync(nm)) return true;
  return markers.some((m) => !fs.existsSync(path.join(nm, m)));
}

function main() {
  if (["1", "true", "yes"].includes(String(process.env.SKIP_PDEU_TWIN_INSTALL || "").toLowerCase())) {
    console.log("[install-pdeu-digital-twin] SKIP_PDEU_TWIN_INSTALL set, skip.");
    process.exit(0);
  }

  const repoRoot = path.join(__dirname, "..");
  const twinDir = findTwinDir(repoRoot);
  if (!twinDir) {
    console.log("[install-pdeu-digital-twin] No pdeu_digitaltwin folder found, skip.");
    process.exit(0);
  }

  if (!needsInstall(twinDir)) {
    console.log("[install-pdeu-digital-twin] Dependencies already present:", twinDir);
    process.exit(0);
  }

  console.log("[install-pdeu-digital-twin] npm install in:", twinDir);
  const r = spawnSync("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: twinDir,
    stdio: "inherit",
    env: { ...process.env, npm_config_loglevel: process.env.npm_config_loglevel || "warn" },
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    console.error("[install-pdeu-digital-twin] npm install failed (status " + r.status + ").");
    process.exit(r.status ?? 1);
  }
  console.log("[install-pdeu-digital-twin] Done.");
  process.exit(0);
}

main();
