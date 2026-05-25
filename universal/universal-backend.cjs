const express = require("express");
const path = require("path");
const fs = require("fs");
const http = require("http");
const WebSocket = require("ws");
const multer = require("multer");
const { spawn, execSync } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const chokidar = require("chokidar");

let YAML;
try {
  YAML = require("yaml");
} catch {
  YAML = null;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function defaultPaths() {
  // `__dirname` here is `<repo>/universal/` (because this file lives there).
  // We want repo root for stable relative paths.
  const root = path.resolve(__dirname, "..");
  // Prefer new location: <repo>/universal/models
  // Back-compat: if empty/missing, fall back to legacy folder
  // <repo>/Universal_Model_Detection_Dashboard-main/models so existing installs work.
  let modelsDir = process.env.UNIVERSAL_MODELS_DIR
    ? path.resolve(process.env.UNIVERSAL_MODELS_DIR)
    : path.join(root, "universal", "models");

  if (!process.env.UNIVERSAL_MODELS_DIR) {
    const legacy = path.join(root, "Universal_Model_Detection_Dashboard-main", "models");
    const hasAnyModelDirs = (p) => {
      try {
        if (!fs.existsSync(p)) return false;
        const ents = fs.readdirSync(p, { withFileTypes: true });
        return ents.some((e) => e.isDirectory());
      } catch {
        return false;
      }
    };
    if (!hasAnyModelDirs(modelsDir) && hasAnyModelDirs(legacy)) {
      modelsDir = legacy;
    }
  }
  const uploadsDir = process.env.UNIVERSAL_UPLOADS_DIR
    ? path.resolve(process.env.UNIVERSAL_UPLOADS_DIR)
    : path.join(root, "universal", "uploads");
  const detectScript = process.env.UNIVERSAL_DETECT_SCRIPT
    ? path.resolve(process.env.UNIVERSAL_DETECT_SCRIPT)
    : path.join(root, "universal", "detect.py");
  return { modelsDir, uploadsDir, detectScript };
}

function scanModels(modelsDir) {
  const models = [];
  if (!fs.existsSync(modelsDir)) return models;

  const dirs = fs
    .readdirSync(modelsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const name of dirs) {
    const dir = path.join(modelsDir, name);
    let files = [];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }

    const nbFile = files.find((f) => f.endsWith(".nb"));
    const soFile = files.find((f) => f.endsWith(".so"));
    const yamlFile = files.find((f) => f === "data.yaml" || f === "dataset.yaml" || f.endsWith(".yaml"));

    const model = {
      name,
      dir,
      nb: nbFile || null,
      lib: soFile || null,
      nb_path: nbFile ? path.join(dir, nbFile) : null,
      lib_path: soFile ? path.join(dir, soFile) : null,
      classes: [name.charAt(0).toUpperCase() + name.slice(1)],
      num_cls: 1,
      listsize: 65,
      yaml: yamlFile || null,
    };

    if (yamlFile && YAML) {
      try {
        const raw = fs.readFileSync(path.join(dir, yamlFile), "utf8");
        const parsed = YAML.parse(raw);
        if (parsed && parsed.names) {
          const names = Array.isArray(parsed.names) ? parsed.names : Object.values(parsed.names);
          if (Array.isArray(names) && names.length) {
            model.classes = names;
            model.num_cls = names.length;
            model.listsize = model.num_cls + 64;
          }
        }
        if (parsed && parsed.nc) model.num_cls = parsed.nc;
      } catch {
        // ignore yaml parse failures
      }
    }

    models.push(model);
  }

  return models;
}

function buildPythonArgs({ model, inputType, inputValue, objThresh, nmsThresh, platform, logLevel, jpegQuality }) {
  const args = ["--level", String(logLevel || 0)];

  // If model binaries exist, pass them through. If not, detect.py can still run
  // in simulation mode (or fail fast if ASNN is installed but files are missing).
  if (model && model.nb_path && model.lib_path) {
    args.push("--model", model.nb_path, "--library", model.lib_path);
  }

  if (inputType === "rtsp") {
    args.push("--type", "rtsp", "--device", inputValue);
  } else if (inputType === "webcam") {
    const [capType, devNum] = String(inputValue || "usb:0").split(":");
    // Forge UI uses "csi:N"; detect.py expects "mipi" + device index.
    const pyType = capType === "csi" ? "mipi" : capType || "usb";
    args.push("--type", pyType, "--device", devNum || "0");
  } else if (inputType === "video") {
    args.push("--type", "video", "--device", inputValue);
  } else if (inputType === "image") {
    args.push("--type", "image", "--device", inputValue);
  }

  if (objThresh != null) args.push("--obj-thresh", String(objThresh));
  if (nmsThresh != null) args.push("--nms-thresh", String(nmsThresh));
  if (platform) args.push("--platform", String(platform));
  if (jpegQuality != null) args.push("--jpeg-quality", String(jpegQuality));

  // Provide class metadata so detect.py doesn't have to parse yaml.
  if (Array.isArray(model.classes) && model.classes.length) {
    args.push("--classes", ...model.classes.map(String));
    args.push("--num-cls", String(model.classes.length));
    args.push("--listsize", String(model.classes.length + 64));
  }

  return args;
}

function isPersonModel(model) {
  if (!model) return false;
  if (String(model.name).toLowerCase() === "person") return true;
  if (model.classes && model.classes.length === 1 && String(model.classes[0]).toLowerCase() === "person") {
    return true;
  }
  return false;
}

function buildPersonArgs({ model, inputType, inputValue, objThresh, nmsThresh, logLevel, jpegQuality }) {
  const args = [
    "--model",
    model.nb_path,
    "--library",
    model.lib_path,
    "--level",
    String(logLevel || 0),
    "--json-stream",
    "--jpeg-quality",
    String(jpegQuality != null ? jpegQuality : 75),
  ];

  if (inputType === "rtsp") {
    args.push("--type", "rtsp", "--device", inputValue);
  } else if (inputType === "webcam") {
    const [capType, devNum] = String(inputValue || "usb:0").split(":");
    const pyType = capType === "csi" ? "mipi" : capType || "usb";
    args.push("--type", pyType, "--device", devNum || "0");
  } else if (inputType === "video") {
    args.push("--type", "video", "--device", inputValue);
  } else if (inputType === "image") {
    args.push("--type", "image", "--device", inputValue);
  }

  if (objThresh != null) args.push("--conf", String(objThresh));
  if (nmsThresh != null) args.push("--nms", String(nmsThresh));
  return args;
}

function createUniversalState({ modelsDir, uploadsDir, detectScript, personScript = null, wsPath = "/universal" }) {
  ensureDir(modelsDir);
  ensureDir(uploadsDir);

  /** Set UNIVERSAL_ALLOW_SIMULATION=1 to allow fake detections when detect.py is missing. */
  const allowSimulation = process.env.UNIVERSAL_ALLOW_SIMULATION === "1";

  // sessionId -> { model, args, inputType, inputValue, status, proc, ws, simInterval?, lastInferencePayload? }
  const sessions = new Map();

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${uuidv4().slice(0, 8)}${ext}`);
    },
  });
  const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

  function wsend(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(data));
      } catch {
        // ignore
      }
    }
  }

  function sendToSession(sid, payload) {
    const session = sessions.get(sid);
    if (!session) return;
    if (payload && payload.type === "inference") {
      session.lastInferencePayload = payload;
    }
    wsend(session.ws, payload);
  }

  /** Start person.py / detect.py (optionally before WebSocket attach — frames buffer until attach). */
  function startInferenceProcess(sid, session, opts = {}) {
    const requireOpenWs = opts.requireOpenWs === true;
    if (!session) return;
    if (session.proc || session.simInterval) return;
    if (session.status === "stopped" || session.status === "error") return;
    if (requireOpenWs && (!session.ws || session.ws.readyState !== WebSocket.OPEN)) return;

    const scriptPath =
      session.isPerson && personScript && fs.existsSync(personScript) ? personScript : detectScript;

    if (!fs.existsSync(scriptPath)) {
      if (!allowSimulation) {
        sendToSession(sid, {
          type: "error",
          message: `Real inference unavailable: ${path.basename(scriptPath)} not found at ${scriptPath}`,
        });
        session.status = "error";
        sessions.set(sid, session);
        return;
      }
      sendToSession(sid, {
        type: "log",
        level: "warn",
        message: `${path.basename(scriptPath)} not found — using simulation mode (set UNIVERSAL_ALLOW_SIMULATION=0 to disable)`,
      });
      startSimulation(sid, session);
      return;
    }

    spawnInference(sid, session);
  }

  function ensureInferenceRunning(sid, session) {
    startInferenceProcess(sid, session, { requireOpenWs: true });
  }

  function stopSession(sid) {
    const session = sessions.get(sid);
    if (!session) return;

    if (session.proc) {
      try {
        session.proc.kill("SIGTERM");
      } catch {
        // ignore
      }
      session.proc = null;
    }
    if (session.simInterval) {
      try {
        clearInterval(session.simInterval);
      } catch {
        // ignore
      }
      session.simInterval = null;
    }
    session.status = "stopped";
    sessions.set(sid, session);
  }

  function startSimulation(sid, session) {
    const send = (payload) => sendToSession(sid, payload);
    let frame = 0;
    const classes = session.model?.classes || ["Object"];
    send({ type: "status", status: "running", simulated: true });
    const interval = setInterval(() => {
      const s = sessions.get(sid);
      if (!s || s.status !== "running") {
        clearInterval(interval);
        return;
      }
      frame++;
      const dets = [];
      const count = Math.random() > 0.4 ? Math.floor(Math.random() * 3) + 1 : 0;
      for (let i = 0; i < count; i++) {
        const cls = Math.floor(Math.random() * classes.length);
        const score = 0.4 + Math.random() * 0.55;
        const x1 = Math.random() * 0.6,
          y1 = Math.random() * 0.6;
        dets.push({
          class_id: cls,
          class_name: classes[cls],
          score: parseFloat(score.toFixed(3)),
          box: [
            parseFloat(x1.toFixed(4)),
            parseFloat(y1.toFixed(4)),
            parseFloat(Math.min(x1 + 0.1 + Math.random() * 0.25, 1).toFixed(4)),
            parseFloat(Math.min(y1 + 0.1 + Math.random() * 0.25, 1).toFixed(4)),
          ],
        });
      }
      send({
        type: "inference",
        frame,
        fps: parseFloat((15 + Math.random() * 10).toFixed(1)),
        inference_ms: parseFloat((8 + Math.random() * 12).toFixed(1)),
        detections: dets,
        simulated: true,
      });
      if (frame % 30 === 0) send({ type: "log", level: "info", message: `[SIM] Frame ${frame} | ${dets.length} detections` });
    }, 66);

    session.simInterval = interval;
    sessions.set(sid, session);
  }

  function spawnInference(sid, session) {
    const send = (payload) => sendToSession(sid, payload);
    const scriptPath =
      session.isPerson && personScript && fs.existsSync(personScript) ? personScript : detectScript;

    let proc;
    try {
      proc = spawn("python3", [scriptPath, ...session.args], {
        cwd: path.dirname(scriptPath),
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });
    } catch (e) {
      send({ type: "error", message: `Failed to spawn: ${e.message}` });
      return;
    }

    session.proc = proc;
    sessions.set(sid, session);
    send({ type: "status", status: "running", pid: proc.pid });

    let buf = "";
    proc.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          send({ type: "inference", ...data });
        } catch {
          send({ type: "log", level: "info", message: line });
        }
      }
    });

    proc.stderr.on("data", (chunk) => {
      send({ type: "log", level: "stderr", message: chunk.toString() });
    });

    proc.on("close", (code) => {
      session.status = "stopped";
      session.proc = null;
      sessions.set(sid, session);
      send({ type: "status", status: "stopped", exitCode: code });
    });

    proc.on("error", (e) => {
      send({ type: "error", message: e.message });
      session.status = "error";
      sessions.set(sid, session);
    });
  }

  function handleAttach(ws, msg) {
    const sessionId = msg && msg.sessionId;
    const session = sessions.get(sessionId);
    if (!session) {
      wsend(ws, { type: "error", message: "Session not found" });
      return;
    }
    session.ws = ws;
    sessions.set(sessionId, session);
    wsend(ws, { type: "attached", sessionId, status: session.status });
    if (session.lastInferencePayload) {
      wsend(ws, session.lastInferencePayload);
    }
    if (session.status === "ready") {
      session.status = "running";
      sessions.set(sessionId, session);
    }
    ensureInferenceRunning(sessionId, session);
  }

  function handleStart(ws, msg) {
    const sessionId = msg && msg.sessionId;
    const session = sessions.get(sessionId);
    if (!session) {
      wsend(ws, { type: "error", message: "Call /universal/api/inference/start first" });
      return;
    }
    session.ws = ws;
    sessions.set(sessionId, session);

    if (session.proc || session.simInterval) {
      wsend(ws, { type: "status", status: "running" });
      return;
    }

    if (session.status === "ready") {
      session.status = "running";
      sessions.set(sessionId, session);
    }
    wsend(ws, { type: "status", status: "starting", message: "Spawning inference process..." });
    ensureInferenceRunning(sessionId, session);
  }

  function handleStop(ws, msg) {
    const sessionId = msg && msg.sessionId;
    stopSession(sessionId);
    wsend(ws, { type: "status", status: "stopped" });
  }

  function createRouter() {
    const router = express.Router();

    router.get("/api/models", (req, res) => {
      res.json({ models: scanModels(modelsDir) });
    });

    router.get("/api/system", (req, res) => {
      let arch = "unknown",
        hostname = "unknown",
        ip = [];
      try {
        arch = execSync("uname -m").toString().trim();
      } catch {}
      try {
        hostname = execSync("hostname").toString().trim();
      } catch {}
      try {
        const raw = execSync("hostname -I 2>/dev/null || ip addr show | grep 'inet ' | awk '{print $2}' | cut -d/ -f1")
          .toString()
          .trim();
        ip = raw.split(/\s+/).filter(Boolean);
      } catch {}
      res.json({ arch, hostname, ip, uptime: process.uptime() });
    });

    router.post("/api/upload", upload.single("file"), (req, res) => {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      res.json({
        filename: req.file.filename,
        originalname: req.file.originalname,
        path: req.file.path,
        size: req.file.size,
      });
    });

    router.delete("/api/upload/:filename", (req, res) => {
      const fp = path.join(uploadsDir, path.basename(req.params.filename));
      try {
        fs.unlinkSync(fp);
        res.json({ ok: true });
      } catch {
        res.status(404).json({ error: "File not found" });
      }
    });

    router.post("/api/inference/start", (req, res) => {
      const {
        modelName,
        inputType,
        inputValue,
        objThresh,
        nmsThresh,
        platform,
        logLevel,
        jpegQuality,
        sessionId: existingId,
      } = req.body || {};

      const models = scanModels(modelsDir);
      const model = models.find((m) => m.name === modelName);
      if (!model) return res.status(404).json({ error: `Model '${modelName}' not found` });

      if (!fs.existsSync(detectScript) && !allowSimulation) {
        return res.status(503).json({
          error: "Real inference is not available on this device (detect.py missing).",
          detectScript,
          hint: "Install universal/detect.py on the edge device, or set UNIVERSAL_ALLOW_SIMULATION=1 for dev-only fake mode.",
        });
      }

      if (!model.nb_path || !model.lib_path) {
        return res.status(400).json({
          error: `Model '${modelName}' is missing .nb or .so files.`,
          hint: "Upload a complete model folder under universal/models (or legacy Universal_Model_Detection_Dashboard-main/models).",
        });
      }

      const sid = existingId || uuidv4();
      if (sessions.has(sid)) stopSession(sid);

      const usePerson = Boolean(personScript && isPersonModel(model));
      const args = usePerson
        ? buildPersonArgs({ model, inputType, inputValue, objThresh, nmsThresh, logLevel, jpegQuality })
        : buildPythonArgs({ model, inputType, inputValue, objThresh, nmsThresh, platform, logLevel, jpegQuality });
      const scriptPath = usePerson ? personScript : detectScript;
      const session = {
        model,
        args,
        inputType,
        inputValue,
        isPerson: usePerson,
        status: "ready",
        proc: null,
        ws: null,
        simInterval: null,
        lastInferencePayload: null,
      };
      sessions.set(sid, session);

      // Wait for WebSocket attach before spawning — browser preview must release V4L2 first.
      res.json({
        sessionId: sid,
        command: `python3 ${scriptPath} ${args.join(" ")}`,
        awaitAttach: true,
        isPerson: usePerson,
      });
    });

    router.post("/api/inference/stop/:sid", (req, res) => {
      stopSession(req.params.sid);
      res.json({ ok: true });
    });

    router.get("/api/inference/sessions", (req, res) => {
      const list = [];
      sessions.forEach((v, k) =>
        list.push({
          id: k,
          status: v.status,
          model: v.model?.name,
          inputType: v.inputType,
          simulated: Boolean(v.simInterval),
          running: Boolean(v.proc || v.simInterval),
        }),
      );
      res.json({ sessions: list });
    });

    return router;
  }

  function attachWebSocket(server) {
    const wss = new WebSocket.Server({ server, path: wsPath });
    wss.on("connection", (ws, req) => {
      ws.on("message", (raw) => {
        let msg;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        switch (msg.type) {
          case "attach":
            handleAttach(ws, msg);
            break;
          case "start":
            handleStart(ws, msg);
            break;
          case "stop":
            handleStop(ws, msg);
            break;
          case "ping":
            wsend(ws, { type: "pong" });
            break;
        }
      });
      ws.on("error", () => {});
    });

    // Watch models dir and broadcast updates (optional)
    chokidar
      .watch(modelsDir, { depth: 1, ignoreInitial: true })
      .on("addDir", () => {
        const msg = JSON.stringify({ type: "models_updated", models: scanModels(modelsDir) });
        wss.clients.forEach((c) => c.readyState === WebSocket.OPEN && c.send(msg));
      })
      .on("add", (p) => {
        if (!p.endsWith(".nb") && !p.endsWith(".so") && !p.endsWith(".yaml")) return;
        const msg = JSON.stringify({ type: "models_updated", models: scanModels(modelsDir) });
        wss.clients.forEach((c) => c.readyState === WebSocket.OPEN && c.send(msg));
      });

    return { wss };
  }

  return { createRouter, attachWebSocket, sessions, stopSession };
}

module.exports = { defaultPaths, createUniversalState, isPersonModel, buildPersonArgs };

