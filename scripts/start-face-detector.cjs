#!/usr/bin/env node
/**
 * NPU face_detector.py — polls live_stream /api/cameras, posts /api/face-events.
 * Args: live_stream/face_detector.args (one per line) or FACE_DETECTOR_ARGS env.
 *
 * Skip: FORGE_SKIP_FACE_STREAM=1 or FORGE_SKIP_FACE_DETECTOR=1
 */
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

function skipRequested() {
  const a = process.env.FORGE_SKIP_FACE_STREAM || process.env.FACE_STREAM_SKIP || "";
  const b = process.env.FORGE_SKIP_FACE_DETECTOR || process.env.FACE_DETECTOR_SKIP || "";
  const off = (v) => ["1", "true", "yes", "on"].includes(String(v).trim().toLowerCase());
  return off(a) || off(b);
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
  return process.env.FACE_DETECTOR_PYTHON || process.env.PYTHON || "python3";
}

function asnnImportOk(python) {
  try {
    const r = spawnSync(python, ["-c", "from asnn.api import asnn"], {
      encoding: "utf8",
      timeout: 15000,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

function main() {
  if (skipRequested()) {
    console.log("[face-detector] Skipped. Idle slot for npm run dev.");
    idleForever();
    return;
  }

  const repoRoot = path.join(__dirname, "..");
  const liveDir = path.join(repoRoot, "live_stream");
  const scriptPath = path.join(liveDir, "face_detector.py");
  if (!fs.existsSync(scriptPath)) {
    console.log("[face-detector] face_detector.py not found — skipped.");
    idleForever();
    return;
  }

  const port = Number(process.env.LIVE_STREAM_PORT || 3010) || 3010;
  const argsFile = path.join(liveDir, "face_detector.args");
  let extraArgs = readArgsFile(argsFile);
  if (!extraArgs?.length && process.env.FACE_DETECTOR_ARGS) {
    extraArgs = process.env.FACE_DETECTOR_ARGS.trim().split(/\s+/);
  }

  if (!extraArgs?.length) {
    const lib = "./yolo11n-face/libnn_yolo11n-face.so";
    const model = "./yolo11n-face/yolo11n-face.nb";
    const recog = "./models/mobilefacenet.onnx";
    if (!fs.existsSync(path.join(liveDir, lib)) || !fs.existsSync(path.join(liveDir, model))) {
      console.log("[face-detector] yolo11n-face models missing — skipped.");
      idleForever();
      return;
    }
    extraArgs = [
      "--library",
      lib,
      "--model",
      model,
      "--recog_model",
      recog,
      "--server",
      `http://127.0.0.1:${port}`,
      "--realtime",
    ];
    if (!fs.existsSync(path.join(liveDir, recog))) {
      console.log(
        `[face-detector] ${recog} not found — skipped. Add mobilefacenet.onnx or live_stream/face_detector.args.`,
      );
      idleForever();
      return;
    }
  }

  const python = resolvePython();
  if (!asnnImportOk(python)) {
    console.log(
      "[face-detector] Python package `asnn` not found — skipped (NPU board only).",
    );
    console.log(
      "[face-detector] Face stream still runs; set FORGE_SKIP_FACE_DETECTOR=1 to hide this slot.",
    );
    idleForever();
    return;
  }

  console.log("[face-detector] starting:", scriptPath);
  const child = spawn(python, [scriptPath, ...extraArgs], {
    cwd: liveDir,
    stdio: "inherit",
    env: process.env,
    windowsHide: false,
  });

  child.on("error", (err) => {
    console.error("[face-detector] failed to start:", err.message);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

main();
