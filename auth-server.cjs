/**
 * Auth API for atomo-forge-suite.
 * Login checks username/password against MeshCentral MySQL DB (table: meshcentral.main).
 */
require('./load-env.cjs');
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const multer = require('multer');
const { defaultPaths, createUniversalState } = require('./universal/universal-backend.cjs');
const { runMigrations } = require('./scripts/db-migrate.cjs');

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// Build an HTTP server so we can attach WebSocket endpoints.
const server = http.createServer(app);

// ── Universal inference backend embedded in Forge ─────────────────────────────
const { modelsDir: universalModelsDir, uploadsDir: universalUploadsDir, detectScript: universalDetectScript } = defaultPaths();
const universal = createUniversalState({
  modelsDir: universalModelsDir,
  uploadsDir: universalUploadsDir,
  detectScript: universalDetectScript,
});
app.use('/universal', universal.createRouter());
universal.attachWebSocket(server);

// ── Model folder upload endpoint ─────────────────────────────────
const modelUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const parts = file.originalname.split('__SEP__');
    const folderName = parts[0] || 'unknown_model';
    const modelDir = path.join(universalModelsDir, folderName);
    fs.mkdirSync(modelDir, { recursive: true });
    cb(null, modelDir);
  },
  filename: (req, file, cb) => {
    const parts = file.originalname.split('__SEP__');
    cb(null, parts[1] || file.originalname);
  }
});
const modelUpload = multer({ storage: modelUploadStorage, limits: { fileSize: 500 * 1024 * 1024 } });

app.post('/universal/api/models/upload-folder', modelUpload.array('files'), (req, res) => {
  if (!req.files || req.files.length === 0)
    return res.status(400).json({ error: 'No files uploaded' });

  const firstOriginal = req.files[0].originalname;
  const folderName = firstOriginal.split('__SEP__')[0];

  const uploaded = req.files.map(f => f.filename);
  const hasNb = uploaded.some(f => f.endsWith('.nb'));
  const hasSo = uploaded.some(f => f.endsWith('.so'));

  if (!hasNb || !hasSo) {
    const modelDir = path.join(universalModelsDir, folderName);
    try { fs.rmSync(modelDir, { recursive: true, force: true }); } catch(e) {}
    return res.status(400).json({ error: 'Model folder must contain .nb and .so files' });
  }

  res.json({ ok: true, folderName, filesCount: req.files.length });
});

// GET /api/health - quick sanity check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'auth-server', clawInstallInProgress: clawInstallInProgress === true });
});

// Same as MeshCentral pass.js: pbkdf2, 12000 iterations, 128 bytes, sha384
const PBKDF2_ITERATIONS = 12000;
const KEY_LEN = 128;
const HASH_ALGO = 'sha384';

const mysqlHost = process.env.MYSQL_HOST || '127.0.0.1';
const mysqlPort = parseInt(process.env.MYSQL_PORT || '3306', 10);
const mysqlConnectTimeout = parseInt(process.env.MYSQL_CONNECT_TIMEOUT_MS || '20000', 10);

const pool = mysql.createPool({
  host: mysqlHost,
  port: mysqlPort,
  user: process.env.MYSQL_USER || 'atomo',
  password: process.env.MYSQL_PASSWORD || 'atomo@1234',
  database: process.env.MYSQL_DATABASE || 'meshcentral',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: Number.isFinite(mysqlConnectTimeout) ? mysqlConnectTimeout : 20000,
});

/** When Forge runs on a different machine than MySQL (e.g. DB on MeshCentral server). */
function respondMySqlPoolError(res, err, logLabel) {
  const code = err && err.code;
  if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
    console.error(logLabel, err);
    return res.status(503).json({
      ok: false,
      error: `Cannot reach MySQL at ${mysqlHost}:${mysqlPort} (${code}).`,
      hint:
        'If MySQL on EC2 is bound to 127.0.0.1 only, your laptop cannot use the public IP on 3306. Use an SSH tunnel (npm run mysql:tunnel) and MYSQL_HOST=127.0.0.1 with a forwarded local port, OR run auth-server on the same server. Otherwise: open TCP ' +
        mysqlPort +
        ' in the cloud SG + firewall and allow remote mysqld. Test: mysql -h ' +
        mysqlHost +
        ' -P ' +
        mysqlPort +
        ' -u USER -p',
      dbTarget: { host: mysqlHost, port: mysqlPort },
    });
  }
  if (code === 'ER_ACCESS_DENIED_ERROR') {
    console.error(logLabel, err);
    return res.status(503).json({
      ok: false,
      error: 'MySQL rejected the username or password.',
      hint: 'Set MYSQL_USER / MYSQL_PASSWORD in .env to a MySQL account that can read the meshcentral database (same as MeshCentral settings.mysql if applicable).',
      dbTarget: { host: mysqlHost, port: mysqlPort },
    });
  }
  console.error(logLabel, err);
  return res.status(500).json({ ok: false, error: 'Server error' });
}

function hashPassword(password, salt, callback) {
  crypto.pbkdf2(password, salt, PBKDF2_ITERATIONS, KEY_LEN, HASH_ALGO, (err, key) => {
    if (err) return callback(err);
    callback(null, key.toString('base64'));
  });
}

// POST /api/auth/login - body: { username, password }
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'Username and password required' });
  }
  const name = String(username).trim().toLowerCase();
  if (!name) return res.status(400).json({ ok: false, error: 'Invalid username' });

  try {
    const [rows] = await pool.query(
      'SELECT id, doc FROM main WHERE type = ? AND LOWER(JSON_UNQUOTE(JSON_EXTRACT(doc, \"$.name\"))) = ? LIMIT 1',
      ['user', name]
    );
    if (!rows || rows.length === 0) {
      return res.status(401).json({ ok: false, error: 'Invalid username or password' });
    }
    const row = rows[0];
    const doc = typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc;
    const salt = doc.salt;
    const storedHash = doc.hash;
    if (!salt || !storedHash) {
      return res.status(401).json({ ok: false, error: 'Invalid username or password' });
    }

    hashPassword(password, salt, (err, hash) => {
      if (err) return res.status(500).json({ ok: false, error: 'Server error' });
      if (hash !== storedHash) {
        return res.status(401).json({ ok: false, error: 'Invalid username or password' });
      }
      res.json({
        ok: true,
        user: { id: row.id, name: doc.name, email: doc.email },
      });
    });
  } catch (e) {
    respondMySqlPoolError(res, e, 'Login error:');
  }
});

// POST /api/devices/register
// body: { serialNumber, deviceName, organizationName, email?, phone?, location?, cloudSync? }
app.post('/api/devices/register', async (req, res) => {
  const body = req.body || {};
  const serialNumber = String(body.serialNumber || '').trim();
  const deviceName = String(body.deviceName || '').trim();
  const organizationName = String(body.organizationName || '').trim();
  const email = body.email != null && String(body.email).trim() !== '' ? String(body.email).trim() : null;
  const phone = body.phone != null && String(body.phone).trim() !== '' ? String(body.phone).trim() : null;
  const location = body.location != null && String(body.location).trim() !== '' ? String(body.location).trim() : null;
  const cloudSync = body.cloudSync === true ? 1 : 0;

  if (!serialNumber || !deviceName || !organizationName) {
    return res.status(400).json({ ok: false, error: 'Serial number, device name and organization are required' });
  }

  try {
    await pool.query(
      `INSERT INTO atomo_registered_devices
        (serial_number, device_name, organization_name, email, phone, location, cloud_sync)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        device_name = VALUES(device_name),
        organization_name = VALUES(organization_name),
        email = VALUES(email),
        phone = VALUES(phone),
        location = VALUES(location),
        cloud_sync = VALUES(cloud_sync)`,
      [serialNumber, deviceName, organizationName, email, phone, location, cloudSync]
    );
    return res.json({ ok: true });
  } catch (e) {
    respondMySqlPoolError(res, e, 'Device register error:');
  }
});

// POST /api/system/open-folder
// body: { folderPath }
// Security: only allow opening folders inside UNIVERSAL_MODELS_DIR
app.post('/api/system/open-folder', async (req, res) => {
  const folderPath = req.body?.folderPath;
  if (!folderPath || typeof folderPath !== 'string') {
    return res.status(400).json({ ok: false, error: 'folderPath is required' });
  }

  const resolved = path.resolve(folderPath);
  if (!(resolved === universalModelsDir || resolved.startsWith(universalModelsDir + path.sep))) {
    return res.status(403).json({ ok: false, error: 'Path not allowed' });
  }

  execFile('xdg-open', [resolved], (err) => {
    if (err) return res.status(500).json({ ok: false, error: 'Failed to open folder' });
    return res.json({ ok: true });
  });
});

// POST /api/claw/install
// Runs: curl -fsSL https://openclaw.ai/install.sh | bash
let clawInstallInProgress = false;
let clawInstallJob = null; // { id, state:'running'|'installed'|'done', startedAt, finishedAt?, result?, childPid?, awaiting? , child? }

function extractSecurityWarning(output) {
  const text = String(output || '');
  if (!text) return null;
  const lines = text.split(/\r?\n/);

  // Prefer the OpenClaw "Security warning — please read." block.
  const securityIdx = lines.findIndex((l) => /security warning/i.test(l));
  const genericIdx = lines.findIndex((l) => /(security|warning|unsafe|untrusted)/i.test(l));
  const idx = securityIdx !== -1 ? securityIdx : genericIdx;
  if (idx === -1) return null;

  // Try to include the whole box-style section (it often starts with a border line).
  let start = idx;
  for (let i = idx; i >= 0 && i >= idx - 10; i--) {
    if (/^(\[api\]\s*)?[┌╭│├└┬─]/.test(lines[i]) || /security/i.test(lines[i])) {
      start = i;
    }
  }

  // End when we hit the "Must read" line (or shortly after), or after a safe max.
  let end = Math.min(lines.length, idx + 120);
  for (let i = idx; i < lines.length && i < idx + 120; i++) {
    if (/must read/i.test(lines[i])) {
      end = Math.min(lines.length, i + 2);
      break;
    }
    if (/docs\.openclaw\.ai\/gateway\/security/i.test(lines[i])) {
      end = Math.min(lines.length, i + 2);
      break;
    }
  }

  return lines.slice(start, end).join('\n').trim();
}

// GET /api/claw/install/status?id=...
app.get('/api/claw/install/status', (req, res) => {
  const id = String(req.query?.id || '');
  if (!clawInstallJob || !id || clawInstallJob.id !== id) {
    return res.status(404).json({ ok: false, error: 'No such install job' });
  }
  if (clawInstallJob.state === 'running') {
    return res.json({
      ok: true,
      id: clawInstallJob.id,
      state: 'running',
      startedAt: clawInstallJob.startedAt,
      awaiting: clawInstallJob.awaiting || null,
    });
  }
  return res.json({
    ok: true,
    id: clawInstallJob.id,
    state: clawInstallJob.state,
    startedAt: clawInstallJob.startedAt,
    finishedAt: clawInstallJob.finishedAt,
    awaiting: clawInstallJob.awaiting || null,
    result: clawInstallJob.result,
  });
});

// POST /api/claw/onboarding/continue
// body: { id, answer: "yes" | "no" }
app.post('/api/claw/onboarding/continue', async (req, res) => {
  const id = String(req.body?.id || '');
  const answer = String(req.body?.answer || '').toLowerCase();
  if (!id || !clawInstallJob || clawInstallJob.id !== id) {
    return res.status(404).json({ ok: false, error: 'No such install job' });
  }
  if (!clawInstallJob.child || !clawInstallJob.child.stdin || clawInstallJob.child.killed) {
    return res.status(409).json({ ok: false, error: 'Installer process is not available' });
  }
  if (answer !== 'yes' && answer !== 'no') {
    return res.status(400).json({ ok: false, error: 'answer must be yes or no' });
  }

  try {
    // Many CLIs accept "y/n" + enter; if not, we can adjust later.
    const payload = answer === 'yes' ? 'y\n' : 'n\n';
    clawInstallJob.child.stdin.write(payload);
    clawInstallJob.awaiting = null;
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to send input' });
  }
});

// POST /api/claw/onboarding/mode
// body: { id, mode: "quickstart" | "manual" }
app.post('/api/claw/onboarding/mode', async (req, res) => {
  const id = String(req.body?.id || '');
  const mode = String(req.body?.mode || '').toLowerCase();
  if (!id || !clawInstallJob || clawInstallJob.id !== id) {
    return res.status(404).json({ ok: false, error: 'No such install job' });
  }
  if (!clawInstallJob.child || !clawInstallJob.child.stdin || clawInstallJob.child.killed) {
    return res.status(409).json({ ok: false, error: 'Installer process is not available' });
  }
  if (mode !== 'quickstart' && mode !== 'manual') {
    return res.status(400).json({ ok: false, error: 'mode must be quickstart or manual' });
  }

  try {
    // Default selection is QuickStart. For manual, send "down arrow" then enter.
    const payload = mode === 'quickstart' ? '\n' : '\x1B[B\n';
    clawInstallJob.child.stdin.write(payload);
    clawInstallJob.awaiting = null;
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to send selection' });
  }
});

// POST /api/claw/onboarding/provider
// body: { id, index }
app.post('/api/claw/onboarding/provider', async (req, res) => {
  const id = String(req.body?.id || '');
  const index = Number(req.body?.index);
  if (!id || !clawInstallJob || clawInstallJob.id !== id) {
    return res.status(404).json({ ok: false, error: 'No such install job' });
  }
  if (!clawInstallJob.child || !clawInstallJob.child.stdin || clawInstallJob.child.killed) {
    return res.status(409).json({ ok: false, error: 'Installer process is not available' });
  }
  if (!Number.isFinite(index) || index < 0 || index > 20) {
    return res.status(400).json({ ok: false, error: 'index must be a non-negative number' });
  }

  try {
    const down = '\x1B[B';
    const payload = (down.repeat(index) || '') + '\n';
    clawInstallJob.child.stdin.write(payload);
    clawInstallJob.awaiting = null;
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to send selection' });
  }
});

// POST /api/claw/onboarding/api-key-method
// body: { id, method: "paste_now" | "external_secret" }
app.post('/api/claw/onboarding/api-key-method', async (req, res) => {
  const id = String(req.body?.id || '');
  const method = String(req.body?.method || '').toLowerCase();
  if (!id || !clawInstallJob || clawInstallJob.id !== id) {
    return res.status(404).json({ ok: false, error: 'No such install job' });
  }
  if (!clawInstallJob.child || !clawInstallJob.child.stdin || clawInstallJob.child.killed) {
    return res.status(409).json({ ok: false, error: 'Installer process is not available' });
  }
  if (method !== 'paste_now' && method !== 'external_secret') {
    return res.status(400).json({ ok: false, error: 'method must be paste_now or external_secret' });
  }

  try {
    // Default selection is "Paste API key now". For external secret, send "down arrow" then enter.
    const payload = method === 'paste_now' ? '\n' : '\x1B[B\n';
    clawInstallJob.child.stdin.write(payload);
    clawInstallJob.awaiting = null;
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to send selection' });
  }
});

// POST /api/claw/onboarding/openrouter-key
// body: { id, apiKey }
app.post('/api/claw/onboarding/openrouter-key', async (req, res) => {
  const id = String(req.body?.id || '');
  const apiKey = String(req.body?.apiKey || '');
  if (!id || !clawInstallJob || clawInstallJob.id !== id) {
    return res.status(404).json({ ok: false, error: 'No such install job' });
  }
  if (!clawInstallJob.child || !clawInstallJob.child.stdin || clawInstallJob.child.killed) {
    return res.status(409).json({ ok: false, error: 'Installer process is not available' });
  }
  if (!apiKey.trim()) {
    return res.status(400).json({ ok: false, error: 'apiKey is required' });
  }

  try {
    clawInstallJob.child.stdin.write(apiKey.trim() + '\n');
    clawInstallJob.awaiting = null;
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to send API key' });
  }
});

// POST /api/claw/onboarding/default-model
// body: { id, index }
app.post('/api/claw/onboarding/default-model', async (req, res) => {
  const id = String(req.body?.id || '');
  const index = Number(req.body?.index);
  if (!id || !clawInstallJob || clawInstallJob.id !== id) {
    return res.status(404).json({ ok: false, error: 'No such install job' });
  }
  if (!clawInstallJob.child || !clawInstallJob.child.stdin || clawInstallJob.child.killed) {
    return res.status(409).json({ ok: false, error: 'Installer process is not available' });
  }
  if (!Number.isFinite(index) || index < 0 || index > 60) {
    return res.status(400).json({ ok: false, error: 'index must be a non-negative number' });
  }

  try {
    const down = '\x1B[B';
    const payload = (down.repeat(index) || '') + '\n';
    clawInstallJob.child.stdin.write(payload);
    clawInstallJob.awaiting = null;
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to send selection' });
  }
});

// POST /api/claw/onboarding/channel
// body: { id, index }
app.post('/api/claw/onboarding/channel', async (req, res) => {
  const id = String(req.body?.id || '');
  const index = Number(req.body?.index);
  if (!id || !clawInstallJob || clawInstallJob.id !== id) {
    return res.status(404).json({ ok: false, error: 'No such install job' });
  }
  if (!clawInstallJob.child || !clawInstallJob.child.stdin || clawInstallJob.child.killed) {
    return res.status(409).json({ ok: false, error: 'Installer process is not available' });
  }
  if (!Number.isFinite(index) || index < 0 || index > 50) {
    return res.status(400).json({ ok: false, error: 'index must be a non-negative number' });
  }

  try {
    const down = '\x1B[B';
    const payload = (down.repeat(index) || '') + '\n';
    clawInstallJob.child.stdin.write(payload);
    clawInstallJob.awaiting = null;
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to send selection' });
  }
});

// POST /api/claw/onboarding/telegram-token-method
// body: { id, method: "enter_now" | "external_secret" }
app.post('/api/claw/onboarding/telegram-token-method', async (req, res) => {
  const id = String(req.body?.id || '');
  const method = String(req.body?.method || '').toLowerCase();
  if (!id || !clawInstallJob || clawInstallJob.id !== id) {
    return res.status(404).json({ ok: false, error: 'No such install job' });
  }
  if (!clawInstallJob.child || !clawInstallJob.child.stdin || clawInstallJob.child.killed) {
    return res.status(409).json({ ok: false, error: 'Installer process is not available' });
  }
  if (method !== 'enter_now' && method !== 'external_secret') {
    return res.status(400).json({ ok: false, error: 'method must be enter_now or external_secret' });
  }

  try {
    // Default selection is "Enter Telegram bot token". For external secret, send down arrow then enter.
    const payload = method === 'enter_now' ? '\n' : '\x1B[B\n';
    clawInstallJob.child.stdin.write(payload);
    clawInstallJob.awaiting = null;
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to send selection' });
  }
});

// POST /api/claw/onboarding/telegram-token
// body: { id, token }
app.post('/api/claw/onboarding/telegram-token', async (req, res) => {
  const id = String(req.body?.id || '');
  const token = String(req.body?.token || '');
  if (!id || !clawInstallJob || clawInstallJob.id !== id) {
    return res.status(404).json({ ok: false, error: 'No such install job' });
  }
  if (!clawInstallJob.child || !clawInstallJob.child.stdin || clawInstallJob.child.killed) {
    return res.status(409).json({ ok: false, error: 'Installer process is not available' });
  }
  if (!token.trim()) {
    return res.status(400).json({ ok: false, error: 'token is required' });
  }

  try {
    clawInstallJob.child.stdin.write(token.trim() + '\n');
    clawInstallJob.awaiting = null;
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to send token' });
  }
});

// POST /api/claw/onboarding/search-provider
// body: { id, index }
app.post('/api/claw/onboarding/search-provider', async (req, res) => {
  const id = String(req.body?.id || '');
  const index = Number(req.body?.index);
  if (!id || !clawInstallJob || clawInstallJob.id !== id) {
    return res.status(404).json({ ok: false, error: 'No such install job' });
  }
  if (!clawInstallJob.child || !clawInstallJob.child.stdin || clawInstallJob.child.killed) {
    return res.status(409).json({ ok: false, error: 'Installer process is not available' });
  }
  if (!Number.isFinite(index) || index < 0 || index > 20) {
    return res.status(400).json({ ok: false, error: 'index must be a non-negative number' });
  }

  try {
    const down = '\x1B[B';
    const payload = (down.repeat(index) || '') + '\n';
    clawInstallJob.child.stdin.write(payload);
    clawInstallJob.awaiting = null;
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to send selection' });
  }
});

app.post('/api/claw/install', async (req, res) => {
  if (clawInstallInProgress && clawInstallJob) {
    return res.json({ ok: true, id: clawInstallJob.id, state: 'running' });
  }
  // Best-effort "install from zero": remove any existing user-level install
  // so the installer doesn't switch into upgrade mode.
  const cmd = [
    'set -euo pipefail',
    'echo "[claw] cleanup: starting"',
    'BIN="$(command -v openclaw 2>/dev/null || true)"',
    'if [ -n "${BIN}" ]; then',
    '  echo "[claw] cleanup: found openclaw at ${BIN}"',
    '  if [ -w "${BIN}" ]; then',
    '    rm -f "${BIN}" && echo "[claw] cleanup: removed ${BIN}" || true',
    '  else',
    '    echo "[claw] cleanup: cannot remove ${BIN} (not writable)"',
    '  fi',
    'fi',
    // common user-level locations
    'rm -rf "${HOME}/.openclaw" "${HOME}/.config/openclaw" "${HOME}/.local/share/openclaw" "${HOME}/.cache/openclaw" 2>/dev/null || true',
    'rm -f "${HOME}/.local/bin/openclaw" "${HOME}/.local/bin/claw" "${HOME}/.local/bin/atomo-claw" 2>/dev/null || true',
    'echo "[claw] cleanup: done"',
    'echo "[claw] install: running fresh install"',
    'TMP="$(mktemp -t openclaw-install.XXXXXX.sh)"',
    'cleanup_tmp() { rm -f "${TMP}" 2>/dev/null || true; }',
    'trap cleanup_tmp EXIT',
    'curl -fsSL https://openclaw.ai/install.sh -o "${TMP}"',
    'chmod +x "${TMP}"',
    // Keep stdin interactive for onboarding prompts.
    'bash "${TMP}"',
  ].join('\n');

  clawInstallInProgress = true;
  const jobId = `${Date.now()}`;
  clawInstallJob = { id: jobId, state: 'running', startedAt: Date.now(), awaiting: null };
  console.log('[claw] install: starting');
  console.log('[claw] install: running:', cmd);

  const child = spawn('bash', ['-lc', cmd], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (clawInstallJob && clawInstallJob.id === jobId) {
    clawInstallJob.childPid = child.pid;
    clawInstallJob.child = child;
  }

  let stdout = '';
  let stderr = '';
  const MAX_CAPTURE = 5 * 1024 * 1024; // 5MB capture (logs still stream to terminal)
  let successDetected = false;

  const markJobDoneFromOutput = () => {
    if (successDetected) return;
    successDetected = true;
    clawInstallInProgress = false;
    const combined = `${stdout}\n${stderr}`;
    const warning = extractSecurityWarning(combined);
    const payload = {
      ok: true,
      stdout,
      stderr,
      securityWarning: warning ? { message: warning } : null,
      detectedBy: 'stdout',
    };
    if (clawInstallJob && clawInstallJob.id === jobId) {
      clawInstallJob.state = 'installed';
      clawInstallJob.finishedAt = Date.now();
      clawInstallJob.result = payload;
    }
    console.log('[claw] install: success detected in output (install complete; onboarding may continue)');
  };

  const timer = setTimeout(() => {
    console.error('[claw] install: timed out after 10 minutes, killing process');
    child.kill('SIGKILL');
  }, 10 * 60 * 1000);

  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    const s = chunk.toString('utf8');
    if (stdout.length < MAX_CAPTURE) stdout += s.slice(0, MAX_CAPTURE - stdout.length);
    // OpenClaw prints this before entering onboarding prompts.
    if (!successDetected && /installed successfully/i.test(s)) {
      markJobDoneFromOutput();
    }
    if (/requires lock-down\. Continue\?/i.test(s) || /Continue\?\s*$/i.test(s)) {
      if (clawInstallJob && clawInstallJob.id === jobId) clawInstallJob.awaiting = 'continue';
    }
    if (/Onboarding mode/i.test(s)) {
      if (clawInstallJob && clawInstallJob.id === jobId) clawInstallJob.awaiting = 'onboarding_mode';
    }
    if (/Model\/auth provider/i.test(s)) {
      if (clawInstallJob && clawInstallJob.id === jobId) clawInstallJob.awaiting = 'provider';
    }
    if (/How do you want to provide this API key\?/i.test(s)) {
      if (clawInstallJob && clawInstallJob.id === jobId) clawInstallJob.awaiting = 'api_key_method';
    }
    if (/Enter OpenRouter API key/i.test(s)) {
      if (clawInstallJob && clawInstallJob.id === jobId) clawInstallJob.awaiting = 'openrouter_api_key';
    }
    if (/Default model/i.test(s)) {
      if (clawInstallJob && clawInstallJob.id === jobId) clawInstallJob.awaiting = 'default_model';
    }
    if (/Select channel\s*\(QuickStart\)/i.test(s)) {
      if (clawInstallJob && clawInstallJob.id === jobId) clawInstallJob.awaiting = 'channel_quickstart';
    }
    if (/How do you want to provide this Telegram bot token\?/i.test(s)) {
      if (clawInstallJob && clawInstallJob.id === jobId) clawInstallJob.awaiting = 'telegram_token_method';
    }
    if (/Enter Telegram bot token/i.test(s)) {
      if (clawInstallJob && clawInstallJob.id === jobId) clawInstallJob.awaiting = 'telegram_token';
    }
    if (/Search provider/i.test(s)) {
      if (clawInstallJob && clawInstallJob.id === jobId) clawInstallJob.awaiting = 'search_provider';
    }
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    const s = chunk.toString('utf8');
    if (stderr.length < MAX_CAPTURE) stderr += s.slice(0, MAX_CAPTURE - stderr.length);
  });

  child.on('error', (err) => {
    clearTimeout(timer);
    clawInstallInProgress = false;
    console.error('[claw] install: spawn error:', err);
    const payload = { ok: false, error: err.message || 'Install failed', stdout, stderr };
    if (clawInstallJob && clawInstallJob.id === jobId) {
      clawInstallJob.state = 'done';
      clawInstallJob.finishedAt = Date.now();
      clawInstallJob.result = payload;
    }
  });

  child.on('close', (code, signal) => {
    clearTimeout(timer);
    if (!successDetected) clawInstallInProgress = false;
    if (code === 0) {
      console.log('[claw] install: completed successfully');
      const combined = `${stdout}\n${stderr}`;
      const warning = extractSecurityWarning(combined);
      if (warning) console.warn('[claw] install: warning detected:\n' + warning);
      const payload = {
        ok: true,
        stdout,
        stderr,
        securityWarning: warning ? { message: warning } : null,
      };
      if (clawInstallJob && clawInstallJob.id === jobId) {
        // If we already marked it done from stdout, keep that result.
        if (clawInstallJob.state !== 'installed' && clawInstallJob.state !== 'done') {
          clawInstallJob.state = 'done';
          clawInstallJob.finishedAt = Date.now();
          clawInstallJob.result = payload;
        }
      }
      return;
    }
    const message = stderr.trim() || `Install failed (code=${code}${signal ? `, signal=${signal}` : ''})`;
    console.error('[claw] install: failed:', message);
    const combined = `${stdout}\n${stderr}`;
    const warning = extractSecurityWarning(combined);
    if (warning) console.warn('[claw] install: warning detected:\n' + warning);
    const payload = {
      ok: false,
      error: message,
      stdout,
      stderr,
      securityWarning: warning ? { message: warning } : null,
    };
    if (clawInstallJob && clawInstallJob.id === jobId) {
      clawInstallJob.state = 'done';
      clawInstallJob.finishedAt = Date.now();
      clawInstallJob.result = payload;
    }
    return;
  });

  // Respond immediately; UI should poll /api/claw/install/status.
  return res.json({ ok: true, id: jobId, state: 'running' });
});

const { registerMeshCentralRoutes } = require('./meshcentral-api.cjs');
registerMeshCentralRoutes(app, { pool });

const PORT = parseInt(process.env.AUTH_PORT || '3003', 10);
server.listen(PORT, () => {
  console.log('Auth API listening on http://localhost:' + PORT);
  console.log('[universal] embedded backend mounted at /universal (models:', universalModelsDir + ')');
  console.log(
    `[mysql] configured ${mysqlHost}:${mysqlPort} user=${process.env.MYSQL_USER || 'atomo'} db=${process.env.MYSQL_DATABASE || 'meshcentral'}`
  );
  pool
    .getConnection()
    .then(async (c) => {
      c.release();
      console.log('[mysql] connectivity check: OK');
      // Auto-apply schema migrations (idempotent CREATE TABLE IF NOT EXISTS).
      // Keeps a fresh dev box working without remembering a manual step.
      try {
        await runMigrations();
      } catch (mErr) {
        console.warn('[mysql] migrations failed:', mErr && (mErr.code || mErr.message));
      }
    })
    .catch((e) => {
      const code = e && e.code;
      let extra = '';
      if (mysqlHost === '127.0.0.1' && mysqlPort !== 3306) {
        extra =
          'You are using a non-default port — start the SSH tunnel first:\n  export FORGE_EC2_SSH_KEY="$HOME/Downloads/your-key.pem"\n  npm run mysql:tunnel';
      } else if (mysqlHost === '127.0.0.1') {
        extra =
          'If MySQL is only on EC2, use SSH tunnel (npm run mysql:tunnel) or run this API on the server.';
      } else {
        extra =
          `Test from this PC: nc -vz ${mysqlHost} ${mysqlPort}\n` +
          'If that fails, fix ON EC2 / AWS (code cannot open the port for you):\n' +
          `  • Security group: inbound TCP ${mysqlPort} from YOUR laptop public IP (not 0.0.0.0/0 unless you accept the risk)\n` +
          '  • Host firewall: sudo ufw status — allow 3306 if ufw is active\n' +
          '  • MySQL: bind-address must allow remote (not 127.0.0.1-only); restart mysql\n' +
          "  • MySQL: GRANT ... ON meshcentral.* TO 'atomo'@'%' or @'YOUR_IP'; FLUSH PRIVILEGES;";
      }
      console.warn(`[mysql] connectivity check FAILED (${code || e.message}).\n${extra}`);
    });
});


