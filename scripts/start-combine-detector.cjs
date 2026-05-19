#!/usr/bin/env node
/**
 * Start combine.py (fire + person NPU detector) in the PDEU digital twin folder.
 * Writes detection_live.json for server.js (no MQTT required).
 *
 * Configure via twin folder file combine_detector.args (one CLI arg per line, # comments OK)
 * or env COMBINE_DETECTOR_ARGS (single string, parsed with minimal quoting).
 *
 * Skip: FORGE_SKIP_COMBINE_DETECTOR=1 or COMBINE_DETECTOR_SKIP=1
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { resolvePdeuDigitalTwinDir } = require("./resolve-pdeu-digital-twin-dir.cjs");

function skipRequested() {
  const raw = process.env.FORGE_SKIP_COMBINE_DETECTOR || process.env.COMBINE_DETECTOR_SKIP || "";
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function idleForever() {
  setInterval(() => {}, 2 ** 30);
}

function readArgsFile(absPath) {
  if (!fs.existsSync(absPath)) return null;
  return fs
    .readFileSync(absPath, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function resolvePython() {
  return process.env.COMBINE_PYTHON || process.env.PYTHON || "python3";
}

function main() {
  if (skipRequested()) {
    console.log("[combine] Skipped (FORGE_SKIP_COMBINE_DETECTOR). Idle slot for npm run dev.");
    idleForever();
    return;
  }

  const repoRoot = path.join(__dirname, "..");
  const twinDir = resolvePdeuDigitalTwinDir(repoRoot);
  if (!twinDir) {
    console.error("[combine] Could not locate digital twin folder.");
    process.exit(1);
  }

  const scriptPath = path.join(twinDir, "combine.py");
  if (!fs.existsSync(scriptPath)) {
    console.log("[combine] combine.py not found — skipped.");
    idleForever();
    return;
  }

  const argsFile = path.join(twinDir, "combine_detector.args");
  let extraArgs = readArgsFile(argsFile);
  if (!extraArgs?.length && process.env.COMBINE_DETECTOR_ARGS) {
    extraArgs = process.env.COMBINE_DETECTOR_ARGS.trim().split(/\s+/);
  }

  if (!extraArgs?.length) {
    console.log(
      "[combine] No combine_detector.args — skipped. Copy combine_detector.args.example → combine_detector.args in the twin folder.",
    );
    idleForever();
    return;
  }

  const jsonName = process.env.DETECTION_JSON_PATH
    ? path.basename(process.env.DETECTION_JSON_PATH)
    : "detection_live.json";
  const jsonPath = process.env.DETECTION_JSON_PATH
    ? path.resolve(process.env.DETECTION_JSON_PATH)
    : path.join(twinDir, jsonName);

  const pyArgs = [
    scriptPath,
    ...extraArgs,
    "--coords-json",
    jsonPath,
    "--headless",
  ];

  const py = resolvePython();
  console.log("[combine] starting:", py, pyArgs.join(" "));
  console.log("[combine] cwd:", twinDir);

  const child = spawn(py, pyArgs, {
    cwd: twinDir,
    stdio: "inherit",
    env: process.env,
    windowsHide: false,
  });

  child.on("error", (err) => {
    console.error("[combine] failed to start:", err.message);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

main();
