/**
 * MeshCentral provisioning API for Atomo Forge: device group + Linux install lines.
 * Requires: ws, meshcentral-data/config.json optional.
 * Optional: pass mysql pool to verify MESHCENTRAL_PROVISION_* against meshcentral.main (same as web login).
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const WebSocket = require('ws');

require('./load-env.cjs');

const PBKDF2_ITERATIONS = 12000;
const KEY_LEN = 128;
const HASH_ALGO = 'sha384';

let _cfgCache;
let _cfgPathUsed = null;

function meshCentralConfigCandidates() {
  return [
    process.env.MESHCENTRAL_CONFIG_PATH,
    path.join(__dirname, '..', 'meshcentral-data', 'config.json'),
    path.join(__dirname, 'meshcentral-data', 'config.json'),
    path.join(process.cwd(), 'meshcentral-data', 'config.json'),
    path.join(process.cwd(), '..', 'meshcentral-data', 'config.json'),
    path.join(process.cwd(), '..', '..', 'meshcentral-data', 'config.json'),
  ].filter(Boolean);
}

function loadMeshCentralDataConfig() {
  if (_cfgCache !== undefined) return _cfgCache;
  _cfgPathUsed = null;
  for (const p of meshCentralConfigCandidates()) {
    try {
      if (fs.existsSync(p)) {
        _cfgCache = JSON.parse(fs.readFileSync(p, 'utf8'));
        _cfgPathUsed = p;
        console.log('[meshcentral] config:', p);
        return _cfgCache;
      }
    } catch (e) {
      console.warn('[meshcentral]', p, e.message);
    }
  }
  _cfgCache = null;
  return null;
}

function getMeshCentralConfigPathUsed() {
  loadMeshCentralDataConfig();
  return _cfgPathUsed;
}

function defaultUrlsFromFile() {
  const cfg = loadMeshCentralDataConfig();
  if (!cfg || !cfg.settings) return { controlUrl: '', agentBase: '' };
  const port = cfg.settings.port != null ? Number(cfg.settings.port) : 443;
  const host =
    (typeof cfg.settings.agentaliasdns === 'string' && cfg.settings.agentaliasdns.trim()) ||
    (typeof cfg.settings.cert === 'string' && cfg.settings.cert.trim()) ||
    '127.0.0.1';
  return {
    controlUrl: `wss://${host}:${port}/control.ashx`,
    agentBase: `https://${host}:${port}`,
  };
}

function agentBaseFromControlUrl(controlWsUrl) {
  try {
    const u = new URL(String(controlWsUrl).trim());
    const secure = u.protocol === 'wss:' || u.protocol === 'https:';
    return `${secure ? 'https:' : 'http:'}//${u.host}`.replace(/\/$/, '');
  } catch (e) {
    return '';
  }
}

function getResolvedMeshCentralUrls() {
  const fromControl = String(process.env.MESHCENTRAL_CONTROL_URL || '').trim();
  const fromAgent = String(process.env.MESHCENTRAL_AGENT_BASE_URL || '').trim();
  const fileDefaults = defaultUrlsFromFile();
  let controlUrl = fromControl || fileDefaults.controlUrl;
  let agentBase = fromAgent.replace(/\/$/, '') || fileDefaults.agentBase;
  if (!agentBase && controlUrl) agentBase = agentBaseFromControlUrl(controlUrl);
  return { controlUrl: controlUrl || '', agentBase: String(agentBase || '').replace(/\/$/, '') };
}

let _atomoProv;
function loadAtomoProvisionFile() {
  if (_atomoProv !== undefined) return _atomoProv;
  const candidates = [
    path.join(__dirname, '..', 'meshcentral-data', 'atomo-provision.json'),
    path.join(__dirname, 'meshcentral-data', 'atomo-provision.json'),
    path.join(process.cwd(), 'meshcentral-data', 'atomo-provision.json'),
    path.join(process.cwd(), '..', 'meshcentral-data', 'atomo-provision.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        const user = String(j.mesUser || j.user || j.username || '').trim();
        const pass = String(j.mesPass || j.pass || j.password || '').trim();
        if (user && pass) {
          _atomoProv = { user, pass };
          return _atomoProv;
        }
      }
    } catch (e) {}
  }
  _atomoProv = null;
  return null;
}

function getProvisionFromConfigSettings() {
  const cfg = loadMeshCentralDataConfig();
  if (!cfg?.settings?.atomoProvision) return null;
  const ap = cfg.settings.atomoProvision;
  const user = String(ap.mesUser || ap.user || '').trim();
  const pass = String(ap.mesPass || ap.pass || '').trim();
  return user && pass ? { user, pass } : null;
}

let _mysqlProvisionResolved = false;
let _mysqlProvisionPair = null;

function readMysqlPairFromMeshCentralConfig() {
  const opt = String(process.env.MESHCENTRAL_USE_MYSQL_PROVISION || '').trim().toLowerCase();
  if (opt === 'false' || opt === '0' || opt === 'no') return null;
  const cfg = loadMeshCentralDataConfig();
  const mysql = cfg?.settings?.mysql;
  if (!mysql || typeof mysql.user !== 'string' || mysql.password == null) return null;
  const user = String(mysql.user).trim();
  const pass = String(mysql.password).trim();
  if (!user || !pass) return null;
  return { user, pass };
}

/**
 * If MESHCENTRAL_PROVISION_* are unset, reuse settings.mysql from meshcentral-data/config.json
 * (same file MeshCentral uses for DB). Works when MeshCentral web login matches that MySQL account
 * (typical dev). Set MESHCENTRAL_USE_MYSQL_PROVISION=false to disable.
 */
function getMysqlProvisionDefaults() {
  if (_mysqlProvisionResolved) return _mysqlProvisionPair;
  _mysqlProvisionResolved = true;
  _mysqlProvisionPair = readMysqlPairFromMeshCentralConfig();
  if (_mysqlProvisionPair) {
    console.warn(
      '[meshcentral] Provisioning uses settings.mysql from meshcentral-data/config.json (same as MeshCentral DB). Override with MESHCENTRAL_PROVISION_USER / MESHCENTRAL_PROVISION_PASS in .env if your web login differs.'
    );
  }
  return _mysqlProvisionPair;
}

function getProvisionUser() {
  const e = String(process.env.MESHCENTRAL_PROVISION_USER || '').trim();
  if (e) return e.toLowerCase();
  const f = loadAtomoProvisionFile();
  if (f?.user) return String(f.user).trim().toLowerCase();
  const s = getProvisionFromConfigSettings();
  if (s?.user) return String(s.user).trim().toLowerCase();
  const m = getMysqlProvisionDefaults();
  return m?.user ? m.user.toLowerCase() : '';
}

function getProvisionPass() {
  const e = String(process.env.MESHCENTRAL_PROVISION_PASS || '').trim();
  if (e) return e;
  const f = loadAtomoProvisionFile();
  if (f?.pass) return f.pass;
  const s = getProvisionFromConfigSettings();
  if (s?.pass) return s.pass;
  const m = getMysqlProvisionDefaults();
  return m?.pass || '';
}

function meshCentralProvisioningConfigured() {
  const { controlUrl, agentBase } = getResolvedMeshCentralUrls();
  return !!(controlUrl && agentBase && getProvisionUser() && getProvisionPass());
}

function hasMeshCentralUrls() {
  const { controlUrl, agentBase } = getResolvedMeshCentralUrls();
  return !!(controlUrl && agentBase);
}

/** Optional credentials from registration UI (same as MeshCentral web login). */
function parseProvisionFromBody(req) {
  const u = String(req.body?.meshCentralUser || req.body?.provisionUser || '').trim();
  const p = String(req.body?.meshCentralPassword ?? req.body?.provisionPassword ?? '').trim();
  if (u && p) return { user: u.toLowerCase(), pass: p };
  return null;
}

function getProvisionDiagnostics() {
  const { controlUrl, agentBase } = getResolvedMeshCentralUrls();
  const user = getProvisionUser();
  const pass = getProvisionPass();
  const envUser = String(process.env.MESHCENTRAL_PROVISION_USER || '').trim();
  const envPass = String(process.env.MESHCENTRAL_PROVISION_PASS || '').trim();
  return {
    meshcentralConfigPath: getMeshCentralConfigPathUsed(),
    meshcentralConfigCandidates: meshCentralConfigCandidates(),
    authServerCwd: process.cwd(),
    meshcentralApiDir: __dirname,
    hasControlUrl: !!controlUrl,
    hasAgentBase: !!agentBase,
    hasProvisionUser: !!user,
    hasProvisionPass: !!pass,
    envHasProvisionUser: !!envUser,
    envHasProvisionPass: !!envPass,
    mysqlProvisionAvailableInConfig: !!readMysqlPairFromMeshCentralConfig(),
  };
}

/** Human-readable hint when URLs or provision login are missing (for API errors + status). */
function buildMeshCentralProvisionMissingMessage() {
  const { controlUrl, agentBase } = getResolvedMeshCentralUrls();
  const user = getProvisionUser();
  const pass = getProvisionPass();
  if (controlUrl && agentBase && user && pass) return '';
  const parts = [];
  if (!controlUrl || !agentBase) {
    parts.push(
      'Set MESHCENTRAL_CONTROL_URL and MESHCENTRAL_AGENT_BASE_URL, or ensure meshcentral-data/config.json is found (e.g. ../meshcentral-data/config.json from ready_atomo-forge-suite) with settings.cert or agentaliasdns and settings.port.'
    );
  } else {
    parts.push(`MeshCentral URLs are resolved (${agentBase}).`);
  }
  if (!user || !pass) {
    parts.push(
      'Add MESHCENTRAL_PROVISION_USER / MESHCENTRAL_PROVISION_PASS in ready_atomo-forge-suite/.env, or settings.atomoProvision in meshcentral-data/config.json, or ensure settings.mysql is set in that same config (auto-used as a fallback). Restart auth-server after changes.'
    );
  }
  return parts.join(' ');
}

function buildMeshCentralControlWsUrl() {
  const { controlUrl } = getResolvedMeshCentralUrls();
  if (!controlUrl) return '';
  let key = String(process.env.MESHCENTRAL_DOMAIN_LOGIN_KEY || '').trim();
  if (!key) {
    try {
      const cfg = loadMeshCentralDataConfig();
      const d0 = cfg?.domains?.[''];
      if (d0?.loginkey != null) {
        key = Array.isArray(d0.loginkey) ? String(d0.loginkey[0] || '').trim() : String(d0.loginkey).trim();
      }
    } catch (e) {}
  }
  if (!key) return controlUrl;
  const sep = controlUrl.includes('?') ? '&' : '?';
  return `${controlUrl}${sep}key=${encodeURIComponent(key)}`;
}

function mapCloseError(msg) {
  const m = String(msg || '');
  if (m === 'noauth-2d' || m === 'noauth-2c' || m === 'noauth-2a') {
    return 'MeshCentral rejected login (noauth). Set MESHCENTRAL_PROVISION_USER / MESHCENTRAL_PROVISION_PASS to your web UI login in .env.';
  }
  if (m === 'nokey') return 'MeshCentral requires domain login key — set MESHCENTRAL_DOMAIN_LOGIN_KEY or domains[""].loginkey in config.json.';
  return m ? `MeshCentral: ${m}` : 'Connection closed';
}

function provisionMismatchMessage(dbUser) {
  const { agentBase } = getResolvedMeshCentralUrls();
  const hint = agentBase
    ? `Use the same username/password that work at ${agentBase}/ (or set MESHCENTRAL_PROVISION_USER to that account). `
    : `Use the same username/password that work in the MeshCentral web UI. `;
  return (
    `Provision login does not match MeshCentral user "${dbUser}" in the database. ` +
    hint +
    `If .env already has the password you want, run from ready_atomo-forge-suite: npm run meshcentral:sync-password -- --apply (updates MySQL to match .env). MYSQL_USER/MYSQL_PASSWORD are only for the database server.`
  );
}

async function verifyProvisionPasswordMatchesDb(pool, credsOverride) {
  if (!pool) return { ok: true, skipped: true };
  const user =
    credsOverride?.user != null
      ? String(credsOverride.user).trim().toLowerCase()
      : getProvisionUser();
  const passPlain =
    credsOverride?.pass != null ? String(credsOverride.pass) : getProvisionPass();
  if (!user || !passPlain) return { ok: true, skipped: true };
  if (!credsOverride && !meshCentralProvisioningConfigured()) return { ok: true, skipped: true };
  try {
    const [rows] = await pool.query(
      'SELECT id, doc FROM main WHERE type = ? AND LOWER(JSON_UNQUOTE(JSON_EXTRACT(doc, \"$.name\"))) = ? LIMIT 1',
      ['user', user]
    );
    if (!rows || rows.length === 0) {
      return {
        ok: false,
        error: `No MeshCentral user "${user}" in the database. Create the account in the MeshCentral UI or set MESHCENTRAL_PROVISION_USER.`,
      };
    }
    const doc = typeof rows[0].doc === 'string' ? JSON.parse(rows[0].doc) : rows[0].doc;
    const salt = doc.salt;
    const storedHash = doc.hash;
    if (!salt || !storedHash) {
      return { ok: false, error: `MeshCentral user "${user}" has no password hash in the database.` };
    }
    return new Promise((resolve) => {
      crypto.pbkdf2(passPlain, salt, PBKDF2_ITERATIONS, KEY_LEN, HASH_ALGO, (err, key) => {
        if (err) return resolve({ ok: false, error: err.message });
        if (key.toString('base64') !== storedHash) {
          resolve({ ok: false, error: provisionMismatchMessage(user) });
        } else resolve({ ok: true });
      });
    });
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * MeshCentral web UI uses meshid.split('/')[2] for Linux install — the segment after mesh/<domain>/,
 * not the full "mesh//..." id. Passing the full id breaks meshsettings lookup (401).
 */
function meshIdForInstallScript(fullMeshId) {
  const parts = String(fullMeshId || '').split('/');
  if (parts.length >= 3) return parts.slice(2).join('/');
  return String(fullMeshId || '');
}

function normalizeMeshMtype(mesh) {
  if (mesh == null || typeof mesh !== 'object') return undefined;
  const v = mesh.mtype;
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

/** One entry for mesh list APIs (preserves all group types; MeshCentral may send mtype as string). */
function meshToSummary(m) {
  if (!m || typeof m !== 'object' || !m._id) return null;
  const mtype = normalizeMeshMtype(m);
  const o = {
    _id: m._id,
    name: typeof m.name === 'string' ? m.name : m.name != null ? String(m.name) : '',
  };
  if (mtype !== undefined) o.mtype = mtype;
  return o;
}

function normalizeMeshGroupName(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** When several groups share the same name, reuse the oldest (stable choice). */
function pickMeshForReuse(list, meshNameNorm) {
  const matches = (Array.isArray(list) ? list : []).filter(
    (m) => m && normalizeMeshGroupName(m.name) === meshNameNorm
  );
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  matches.sort((a, b) => {
    const ca = typeof a.creation === 'number' ? a.creation : 0;
    const cb = typeof b.creation === 'number' ? b.creation : 0;
    return ca - cb;
  });
  return matches[0];
}

function buildLinuxMeshCommands(meshid) {
  const base = getResolvedMeshCentralUrls().agentBase.replace(/\/$/, '');
  if (!base) return null;
  const idArg = meshIdForInstallScript(meshid);
  const loginkey = process.env.MESHCENTRAL_INVITE_KEY ? `&key=${encodeURIComponent(process.env.MESHCENTRAL_INVITE_KEY)}` : '';
  const meshagentsUrl = `${base}/meshagents?script=1${loginkey}`;
  const certFlag = base.startsWith('https') ? ' --no-check-certificate' : '';
  const linuxInstall = `(wget "${meshagentsUrl}"${certFlag} -O ./meshinstall.sh || wget "${meshagentsUrl}" --no-proxy${certFlag} -O ./meshinstall.sh) && chmod 755 ./meshinstall.sh && sudo -E ./meshinstall.sh ${base} '${idArg}' || ./meshinstall.sh ${base} '${idArg}'`;
  const linuxUninstall = `(wget "${meshagentsUrl}"${certFlag} -O ./meshinstall.sh || wget "${meshagentsUrl}" --no-proxy${certFlag} -O ./meshinstall.sh) && chmod 755 ./meshinstall.sh && sudo -E ./meshinstall.sh uninstall ${base} '${idArg}' || ./meshinstall.sh uninstall ${base} '${idArg}'`;
  return { linuxInstall, linuxUninstall };
}

/** Max time for wget + meshinstall (slow links / large agent). */
const RUN_AGENT_TIMEOUT_MS = Number(process.env.MESHCENTRAL_RUN_AGENT_TIMEOUT_MS) || 600000;

/**
 * Runs the same bash one-liner as the UI (install or uninstall) on the host running this process.
 * Enrolls that machine in MeshCentral — not remote PCs. Requires Linux (or compatible shell with wget).
 * @param {{ sudoPassword?: string }} [options] — If sudoPassword is non-empty, `sudo -E` is run as `sudo -S -E` and the password is written to stdin (non-interactive).
 */
function execMeshAgentCommand(shellCmd, options) {
  const sudoPassword =
    options && typeof options.sudoPassword === 'string' ? options.sudoPassword : '';
  const useSudoStdin = sudoPassword.length > 0;
  const cmd = useSudoStdin ? shellCmd.replace(/\bsudo -E\b/g, 'sudo -k -S -E') : shellCmd;
  const maxBuf = 12 * 1024 * 1024;

  return new Promise((resolve) => {
    const child = spawn('/bin/bash', ['-c', cmd], {
      env: { ...process.env },
    });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const t = setTimeout(() => {
      killed = true;
      try {
        child.kill('SIGKILL');
      } catch (e) {}
    }, RUN_AGENT_TIMEOUT_MS);

    function append(which, chunk) {
      const s = chunk.toString();
      if (which === 'out') stdout += s;
      else stderr += s;
      if (stdout.length + stderr.length > maxBuf && !killed) {
        killed = true;
        try {
          child.kill('SIGKILL');
        } catch (e) {}
      }
    }
    child.stdout.on('data', (d) => append('out', d));
    child.stderr.on('data', (d) => append('err', d));
    if (useSudoStdin) {
      try {
        child.stdin.write(sudoPassword + '\n', 'utf8');
        child.stdin.end();
      } catch (e) {
        stderr += String(e.message || e);
      }
    }

    child.on('close', (code, signal) => {
      clearTimeout(t);
      const exitCode = code != null ? code : signal ? 1 : 0;
      resolve({
        ok: exitCode === 0 && !signal,
        code: exitCode,
        stdout,
        stderr,
      });
    });
    child.on('error', (err) => {
      clearTimeout(t);
      resolve({
        ok: false,
        code: 1,
        stdout,
        stderr: stderr + (err.message || 'spawn error'),
      });
    });
  });
}

function createMeshCentralGroup(meshname, credsOverride) {
  return new Promise((resolve, reject) => {
    const wsUrl = buildMeshCentralControlWsUrl();
    const user =
      credsOverride?.user != null
        ? String(credsOverride.user).trim().toLowerCase()
        : getProvisionUser();
    const pass =
      credsOverride?.pass != null ? String(credsOverride.pass) : getProvisionPass();
    if (!wsUrl || !user || !pass) {
      reject(new Error('MeshCentral provisioning incomplete'));
      return;
    }
    const tlsStrict = process.env.MESHCENTRAL_TLS_REJECT_UNAUTHORIZED === 'true';
    const headers = {
      'x-meshauth':
        Buffer.from(String(user), 'utf8').toString('base64') +
        ',' +
        Buffer.from(String(pass), 'utf8').toString('base64'),
    };
    const ws = new WebSocket(wsUrl, { rejectUnauthorized: tlsStrict, headers });
    let settled = false;
    let sent = false;
    let t = setTimeout(() => finish(new Error('MeshCentral connection timed out')), 45000);
    let fb = setTimeout(() => sendCreate(), 2500);
    const RESPONSE_ID = 'atomo-forge';
    const cmd = {
      action: 'createmesh',
      meshname: String(meshname).slice(0, 128),
      meshtype: 2,
      responseid: RESPONSE_ID,
    };
    function finish(err, meshid) {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      clearTimeout(fb);
      try {
        ws.close();
      } catch (e) {}
      if (err) reject(err);
      else resolve(meshid);
    }
    function sendCreate() {
      if (sent || settled) return;
      sent = true;
      try {
        ws.send(JSON.stringify(cmd));
      } catch (e) {
        finish(new Error(e.message || 'send failed'));
      }
    }
    ws.on('message', (data) => {
      if (settled) return;
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        return;
      }
      if (!sent && (msg.action === 'serverinfo' || msg.action === 'userinfo')) {
        clearTimeout(fb);
        sendCreate();
      }
      if (msg.action === 'createmesh' && msg.responseid === RESPONSE_ID) {
        if (msg.result === 'ok' && msg.meshid) finish(null, msg.meshid);
        else finish(new Error(typeof msg.result === 'string' ? msg.result : 'createmesh failed'));
        return;
      }
      if (msg.action === 'close') {
        finish(new Error(mapCloseError(msg.msg)));
      }
    });
    ws.on('error', (err) => finish(err || new Error('WebSocket error')));
    ws.on('close', () => {
      if (!settled) finish(new Error('Connection closed before group was created'));
    });
  });
}

/**
 * Deletes a device group (requires full admin on that group in MeshCentral — same as the web UI).
 */
function deleteMeshCentralGroup(meshid, meshname, credsOverride) {
  return new Promise((resolve, reject) => {
    const wsUrl = buildMeshCentralControlWsUrl();
    const user =
      credsOverride?.user != null
        ? String(credsOverride.user).trim().toLowerCase()
        : getProvisionUser();
    const pass =
      credsOverride?.pass != null ? String(credsOverride.pass) : getProvisionPass();
    if (!wsUrl || !user || !pass) {
      reject(new Error('MeshCentral provisioning incomplete'));
      return;
    }
    const tlsStrict = process.env.MESHCENTRAL_TLS_REJECT_UNAUTHORIZED === 'true';
    const headers = {
      'x-meshauth':
        Buffer.from(String(user), 'utf8').toString('base64') +
        ',' +
        Buffer.from(String(pass), 'utf8').toString('base64'),
    };
    const ws = new WebSocket(wsUrl, { rejectUnauthorized: tlsStrict, headers });
    let settled = false;
    let sent = false;
    let t = setTimeout(() => finish(new Error('MeshCentral connection timed out')), 45000);
    /** Match mesh list timing: wait for userinfo before deletemesh. */
    let fb = setTimeout(() => sendDelete(), 6000);
    const RESPONSE_ID = 'atomo-forge-delete';
    const cmd = {
      action: 'deletemesh',
      meshid: String(meshid).trim(),
      meshname: String(meshname || 'Device group').slice(0, 128),
      responseid: RESPONSE_ID,
    };
    function finish(err) {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      clearTimeout(fb);
      try {
        ws.close();
      } catch (e) {}
      if (err) reject(err);
      else resolve();
    }
    function sendDelete() {
      if (sent || settled) return;
      sent = true;
      try {
        ws.send(JSON.stringify(cmd));
      } catch (e) {
        finish(new Error(e.message || 'send failed'));
      }
    }
    ws.on('message', (data) => {
      if (settled) return;
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        return;
      }
      if (!sent && msg.action === 'userinfo') {
        clearTimeout(fb);
        sendDelete();
      }
      if (msg.action === 'deletemesh' && msg.responseid === RESPONSE_ID) {
        if (msg.result === 'ok') finish(null);
        else finish(new Error(typeof msg.result === 'string' ? msg.result : 'deletemesh failed'));
        return;
      }
      if (msg.action === 'close') {
        finish(new Error(mapCloseError(msg.msg)));
      }
    });
    ws.on('error', (err) => finish(err || new Error('WebSocket error')));
    ws.on('close', () => {
      if (!settled) finish(new Error('Connection closed before group was deleted'));
    });
  });
}

/**
 * @param {null|{user:string,pass:string}} credsOverride - If set, use this MeshCentral web login; else .env / server provision.
 */
function fetchMeshCentralMeshes(credsOverride) {
  return new Promise((resolve, reject) => {
    const wsUrl = buildMeshCentralControlWsUrl();
    const user =
      credsOverride != null && credsOverride.user != null
        ? String(credsOverride.user).trim().toLowerCase()
        : getProvisionUser();
    const pass =
      credsOverride != null && credsOverride.pass != null ? String(credsOverride.pass) : getProvisionPass();
    if (!wsUrl || !user || !pass) {
      reject(new Error('MeshCentral provisioning incomplete'));
      return;
    }
    const tlsStrict = process.env.MESHCENTRAL_TLS_REJECT_UNAUTHORIZED === 'true';
    const headers = {
      'x-meshauth':
        Buffer.from(String(user), 'utf8').toString('base64') +
        ',' +
        Buffer.from(String(pass), 'utf8').toString('base64'),
    };
    const ws = new WebSocket(wsUrl, { rejectUnauthorized: tlsStrict, headers });
    let settled = false;
    let sent = false;
    const TAG = 'atomo-forge-meshes';
    let t = setTimeout(() => finish(new Error('MeshCentral connection timed out')), 45000);
    /** Wait for userinfo (full session) before listing meshes; serverinfo alone can be too early on some setups. */
    let fb = setTimeout(() => sendMeshes(), 6000);
    function finish(err, meshes) {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      clearTimeout(fb);
      try {
        ws.close();
      } catch (e) {}
      if (err) reject(err);
      else resolve(meshes);
    }
    function sendMeshes() {
      if (sent || settled) return;
      sent = true;
      try {
        ws.send(JSON.stringify({ action: 'meshes', tag: TAG }));
      } catch (e) {
        finish(new Error(e.message || 'send failed'));
      }
    }
    ws.on('message', (data) => {
      if (settled) return;
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        return;
      }
      if (!sent && msg.action === 'userinfo') {
        clearTimeout(fb);
        sendMeshes();
      }
      if (msg.action === 'meshes' && msg.tag === TAG) {
        finish(null, Array.isArray(msg.meshes) ? msg.meshes : []);
        return;
      }
      if (msg.action === 'close') finish(new Error(mapCloseError(msg.msg)));
    });
    ws.on('error', (err) => finish(err || new Error('WebSocket error')));
    ws.on('close', () => {
      if (!settled) finish(new Error('Connection closed'));
    });
  });
}

/** One in-flight create/reuse per user + normalized name (stops double-click races creating duplicates). */
const _createGroupChains = new Map();
function runCreateGroupSerialized(lockKey, fn) {
  const prev = _createGroupChains.get(lockKey) || Promise.resolve();
  const result = prev.then(() => fn());
  _createGroupChains.set(lockKey, result.catch(() => {}));
  return result;
}

function registerMeshCentralRoutes(app, options) {
  const pool = options && options.pool ? options.pool : null;

  app.get('/api/meshcentral/status', async (req, res) => {
    const { controlUrl, agentBase } = getResolvedMeshCentralUrls();
    const urlsOk = hasMeshCentralUrls();
    const serverProv = meshCentralProvisioningConfigured();
    const hasCreds = !!(getProvisionUser() && getProvisionPass());
    const v = serverProv ? await verifyProvisionPasswordMatchesDb(pool, null) : { ok: true, skipped: true };
    const provisionHint = urlsOk
      ? serverProv
        ? null
        : 'Enter your MeshCentral username and password below (same as the web UI), or configure the server with .env / meshcentral-data config.'
      : buildMeshCentralProvisionMissingMessage();
    res.json({
      ok: true,
      configured: urlsOk,
      serverProvisionConfigured: serverProv,
      agentBaseUrl: agentBase || null,
      controlUrl: controlUrl || null,
      needsCredentials: !!(controlUrl && agentBase && !hasCreds),
      provisionHint,
      provisionDiagnostics: getProvisionDiagnostics(),
      provisionPasswordMatchesDb: v.skipped ? null : v.ok === true,
      provisionDbError: v.ok || v.skipped ? null : v.error,
    });
  });

  app.get('/api/meshcentral/debug', (req, res) => {
    res.json({
      ok: true,
      ...getProvisionDiagnostics(),
      provisionConfigured: meshCentralProvisioningConfigured(),
      hint: buildMeshCentralProvisionMissingMessage() || null,
    });
  });

  app.get('/api/meshcentral/meshes', async (req, res) => {
    if (!meshCentralProvisioningConfigured()) {
      return res.status(503).json({ ok: false, error: buildMeshCentralProvisionMissingMessage() });
    }
    const v = await verifyProvisionPasswordMatchesDb(pool);
    if (!v.ok && !v.skipped) {
      return res.status(503).json({ ok: false, error: v.error });
    }
    try {
      const raw = await fetchMeshCentralMeshes(null);
      const meshes = (Array.isArray(raw) ? raw : [])
        .map((m) => meshToSummary(m))
        .filter((m) => m != null);
      res.json({ ok: true, meshes, count: meshes.length });
    } catch (e) {
      console.error('[meshcentral] meshes:', e.message);
      res.status(500).json({ ok: false, error: e.message || 'MeshCentral error' });
    }
  });

  /**
   * Same as GET but accepts MeshCentral web credentials in JSON (for registration UI when not using server-only provision).
   * Body: { meshCentralUser?, meshCentralPassword? }
   */
  app.post('/api/meshcentral/meshes', async (req, res) => {
    const bodyCreds = parseProvisionFromBody(req);
    if (!hasMeshCentralUrls()) {
      return res.status(503).json({
        ok: false,
        error: buildMeshCentralProvisionMissingMessage(),
        diagnostics: getProvisionDiagnostics(),
      });
    }
    if (!bodyCreds && !meshCentralProvisioningConfigured()) {
      return res.status(400).json({
        ok: false,
        error:
          'Provide meshCentralUser and meshCentralPassword (same as MeshCentral web login), or configure server provisioning in ready_atomo-forge-suite/.env or meshcentral-data/config.json (settings.mysql).',
      });
    }
    const creds = bodyCreds || {
      user: getProvisionUser(),
      pass: getProvisionPass(),
    };
    if (!creds.user || !creds.pass) {
      return res.status(400).json({
        ok: false,
        error: 'MeshCentral username and password are missing.',
      });
    }
    const v = await verifyProvisionPasswordMatchesDb(pool, bodyCreds);
    if (!v.ok && !v.skipped) {
      return res.status(503).json({ ok: false, error: v.error });
    }
    try {
      const raw = await fetchMeshCentralMeshes(creds);
      const meshes = (Array.isArray(raw) ? raw : [])
        .map((m) => meshToSummary(m))
        .filter((m) => m != null);
      res.json({ ok: true, meshes, count: meshes.length });
    } catch (e) {
      console.error('[meshcentral] meshes (POST):', e.message);
      res.status(500).json({ ok: false, error: e.message || 'MeshCentral error' });
    }
  });

  /**
   * Install/uninstall command lines for a group you already have access to.
   * Body: { meshid, meshCentralUser?, meshCentralPassword? }
   */
  app.post('/api/meshcentral/mesh-commands', async (req, res) => {
    const bodyCreds = parseProvisionFromBody(req);
    if (!hasMeshCentralUrls()) {
      return res.status(503).json({
        ok: false,
        error: buildMeshCentralProvisionMissingMessage(),
        diagnostics: getProvisionDiagnostics(),
      });
    }
    if (!bodyCreds && !meshCentralProvisioningConfigured()) {
      return res.status(400).json({
        ok: false,
        error:
          'Provide meshCentralUser and meshCentralPassword (same as MeshCentral web login), or configure server provisioning in ready_atomo-forge-suite/.env or meshcentral-data/config.json (settings.mysql).',
      });
    }
    const creds = bodyCreds || {
      user: getProvisionUser(),
      pass: getProvisionPass(),
    };
    if (!creds.user || !creds.pass) {
      return res.status(400).json({
        ok: false,
        error: 'MeshCentral username and password are missing.',
      });
    }
    const v = await verifyProvisionPasswordMatchesDb(pool, bodyCreds);
    if (!v.ok && !v.skipped) {
      return res.status(503).json({ ok: false, error: v.error });
    }
    const meshid = String(req.body?.meshid || '').trim();
    if (!meshid) {
      return res.status(400).json({ ok: false, error: 'meshid is required' });
    }
    try {
      const raw = await fetchMeshCentralMeshes(creds);
      const list = Array.isArray(raw) ? raw : [];
      const found = list.find((m) => m && m._id === meshid);
      if (!found) {
        return res.status(404).json({
          ok: false,
          error: 'That device group was not found for this MeshCentral account.',
        });
      }
      const cmds = buildLinuxMeshCommands(meshid);
      if (!cmds) {
        return res.status(500).json({ ok: false, error: 'Could not build install commands' });
      }
      res.json({
        ok: true,
        meshid,
        meshName: found.name,
        meshReused: true,
        linuxInstall: cmds.linuxInstall,
        linuxUninstall: cmds.linuxUninstall,
      });
    } catch (e) {
      console.error('[meshcentral] mesh-commands:', e.message);
      res.status(500).json({ ok: false, error: e.message || 'MeshCentral error' });
    }
  });

  /**
   * Delete a device group (MeshCentral deletemesh). Requires full administrator rights on that group.
   * Body: { meshid, meshName?, meshCentralUser?, meshCentralPassword? }
   */
  app.post('/api/meshcentral/delete-group', async (req, res) => {
    const bodyCreds = parseProvisionFromBody(req);
    if (!hasMeshCentralUrls()) {
      return res.status(503).json({
        ok: false,
        error: buildMeshCentralProvisionMissingMessage(),
        diagnostics: getProvisionDiagnostics(),
      });
    }
    if (!bodyCreds && !meshCentralProvisioningConfigured()) {
      return res.status(400).json({
        ok: false,
        error:
          'Provide meshCentralUser and meshCentralPassword (same as MeshCentral web login), or configure server provisioning in ready_atomo-forge-suite/.env or meshcentral-data/config.json (settings.mysql).',
      });
    }
    const creds = bodyCreds || {
      user: getProvisionUser(),
      pass: getProvisionPass(),
    };
    if (!creds.user || !creds.pass) {
      return res.status(400).json({
        ok: false,
        error: 'MeshCentral username and password are missing.',
      });
    }
    const v = await verifyProvisionPasswordMatchesDb(pool, bodyCreds);
    if (!v.ok && !v.skipped) {
      return res.status(503).json({ ok: false, error: v.error });
    }
    const meshid = String(req.body?.meshid || '').trim();
    if (!meshid) {
      return res.status(400).json({ ok: false, error: 'meshid is required' });
    }
    const meshNameHint = String(req.body?.meshName || req.body?.meshname || '').trim();
    try {
      const raw = await fetchMeshCentralMeshes(creds);
      const list = Array.isArray(raw) ? raw : [];
      const found = list.find((m) => m && m._id === meshid);
      const nameForDelete =
        meshNameHint ||
        (found && typeof found.name === 'string' ? found.name.trim() : '') ||
        '';
      if (!nameForDelete) {
        return res.status(400).json({
          ok: false,
          error:
            'meshName (device group name) is required — e.g. the same name you used when creating the group. The group may not appear in the mesh list yet.',
        });
      }
      await deleteMeshCentralGroup(meshid, nameForDelete, creds);
      res.json({ ok: true, meshid });
    } catch (e) {
      const msg = e.message || String(e);
      console.error('[meshcentral] delete-group:', msg);
      const lower = msg.toLowerCase();
      const status =
        lower.includes('access denied') || lower.includes('permission') ? 403 : 500;
      res.status(status).json({ ok: false, error: msg });
    }
  });

  app.post('/api/meshcentral/create-group', async (req, res) => {
    const bodyCreds = parseProvisionFromBody(req);
    if (!hasMeshCentralUrls()) {
      return res.status(503).json({
        ok: false,
        error: buildMeshCentralProvisionMissingMessage(),
        diagnostics: getProvisionDiagnostics(),
      });
    }
    if (!bodyCreds && !meshCentralProvisioningConfigured()) {
      return res.status(400).json({
        ok: false,
        error:
          'Provide meshCentralUser and meshCentralPassword (same as MeshCentral web login), or configure server provisioning in ready_atomo-forge-suite/.env or meshcentral-data/config.json (settings.mysql).',
      });
    }
    const creds = bodyCreds || {
      user: getProvisionUser(),
      pass: getProvisionPass(),
    };
    if (!creds.user || !creds.pass) {
      return res.status(400).json({
        ok: false,
        error: 'MeshCentral username and password are missing.',
      });
    }
    const v = await verifyProvisionPasswordMatchesDb(pool, bodyCreds);
    if (!v.ok && !v.skipped) {
      return res.status(503).json({ ok: false, error: v.error });
    }
    const meshName = String(req.body?.meshName || '').trim();
    if (!meshName || meshName.length > 128) {
      return res.status(400).json({ ok: false, error: 'meshName required (1–128 chars)' });
    }
    const meshNameNorm = normalizeMeshGroupName(meshName);
    const skipReuse =
      req.body?.forceNew === true ||
      req.body?.forceNew === 'true' ||
      req.body?.forceNew === 1 ||
      req.body?.reuseIfExists === false ||
      req.body?.reuseIfExists === 'false' ||
      req.body?.reuseIfExists === 0;
    const wantsReuse = !skipReuse;
    const lockKey = `${String(creds.user).toLowerCase().trim()}::${meshNameNorm}`;
    try {
      await runCreateGroupSerialized(lockKey, async () => {
        if (wantsReuse) {
          const raw = await fetchMeshCentralMeshes(creds);
          const list = Array.isArray(raw) ? raw : [];
          const match = pickMeshForReuse(list, meshNameNorm);
          if (match && match._id) {
            const cmds = buildLinuxMeshCommands(match._id);
            if (!cmds) {
              if (!res.headersSent) res.status(500).json({ ok: false, error: 'Could not build install commands' });
              return;
            }
            if (!res.headersSent) {
              res.json({
                ok: true,
                meshid: match._id,
                meshName,
                meshReused: true,
                linuxInstall: cmds.linuxInstall,
                linuxUninstall: cmds.linuxUninstall,
              });
            }
            return;
          }
        }
        const meshid = await createMeshCentralGroup(meshName, creds);
        const cmds = buildLinuxMeshCommands(meshid);
        if (!cmds) {
          if (!res.headersSent) res.status(500).json({ ok: false, error: 'Could not build install commands' });
          return;
        }
        if (!res.headersSent) {
          res.json({
            ok: true,
            meshid,
            meshName,
            meshReused: false,
            linuxInstall: cmds.linuxInstall,
            linuxUninstall: cmds.linuxUninstall,
          });
        }
      });
    } catch (e) {
      console.error('[meshcentral] create-group:', e.message);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: e.message || 'MeshCentral error' });
      }
    }
  });

  /**
   * POST body: { meshid, action: "install" | "uninstall", meshCentralUser?, meshCentralPassword?, sudoPassword? }
   * Executes the Mesh Linux install/uninstall script on this server (same shell command as copy-paste).
   * Optional sudoPassword: Linux account password for sudo -S when the script runs with sudo (non-TTY API).
   */
  app.post('/api/meshcentral/run-agent', async (req, res) => {
    if (String(process.env.MESHCENTRAL_DISABLE_RUN_AGENT || '').trim().toLowerCase() === 'true') {
      return res.status(403).json({
        ok: false,
        error: 'Run agent is disabled (MESHCENTRAL_DISABLE_RUN_AGENT=true).',
      });
    }
    if (process.platform === 'win32') {
      return res.status(400).json({
        ok: false,
        error:
          'Run agent is only supported when the auth server runs on Linux. On Windows, copy the command and run it on each Linux device, or use SSH.',
      });
    }
    const bodyCreds = parseProvisionFromBody(req);
    if (!hasMeshCentralUrls()) {
      return res.status(503).json({
        ok: false,
        error: buildMeshCentralProvisionMissingMessage(),
        diagnostics: getProvisionDiagnostics(),
      });
    }
    if (!bodyCreds && !meshCentralProvisioningConfigured()) {
      return res.status(400).json({
        ok: false,
        error:
          'Provide meshCentralUser and meshCentralPassword (same as MeshCentral web login), or configure server provisioning in ready_atomo-forge-suite/.env or meshcentral-data/config.json (settings.mysql).',
      });
    }
    const creds = bodyCreds || {
      user: getProvisionUser(),
      pass: getProvisionPass(),
    };
    if (!creds.user || !creds.pass) {
      return res.status(400).json({
        ok: false,
        error: 'MeshCentral username and password are missing.',
      });
    }
    const v = await verifyProvisionPasswordMatchesDb(pool, bodyCreds);
    if (!v.ok && !v.skipped) {
      return res.status(503).json({ ok: false, error: v.error });
    }
    const meshid = String(req.body?.meshid || '').trim();
    const action = String(req.body?.action || 'install').toLowerCase();
    if (!meshid) {
      return res.status(400).json({ ok: false, error: 'meshid is required' });
    }
    if (action !== 'install' && action !== 'uninstall') {
      return res.status(400).json({ ok: false, error: 'action must be "install" or "uninstall"' });
    }
    const cmds = buildLinuxMeshCommands(meshid);
    if (!cmds) {
      return res.status(500).json({ ok: false, error: 'Could not build install command (check MESHCENTRAL_AGENT_BASE_URL)' });
    }
    const shellCmd = action === 'install' ? cmds.linuxInstall : cmds.linuxUninstall;
    const sudoPassword =
      req.body?.sudoPassword != null || req.body?.hostSudoPassword != null
        ? String(req.body?.sudoPassword ?? req.body?.hostSudoPassword)
        : '';
    try {
      const out = await execMeshAgentCommand(shellCmd, { sudoPassword });
      res.json({
        ok: out.ok,
        exitCode: out.code,
        stdout: out.stdout,
        stderr: out.stderr,
        error: out.ok ? null : 'Command exited with an error. See stderr. Common causes: sudo needs a password, or this host cannot reach the MeshCentral URL.',
      });
    } catch (e) {
      console.error('[meshcentral] run-agent:', e.message);
      res.status(500).json({ ok: false, error: e.message || 'run-agent failed' });
    }
  });
}

module.exports = { registerMeshCentralRoutes };
