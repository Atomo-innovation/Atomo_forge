/**
 * Server-side detection image export (works over http:// LAN — no showDirectoryPicker).
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const WORKSPACE_IDS = new Set(['cameras', 'cameras2', 'cameras3', 'cameras4']);

function configPath(repoRoot) {
  return path.join(repoRoot, '.data', 'detection-export-folders.json');
}

function loadConfig(repoRoot) {
  const p = configPath(repoRoot);
  try {
    if (!fs.existsSync(p)) return { workspaces: {} };
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return raw && typeof raw === 'object' && raw.workspaces ? raw : { workspaces: {} };
  } catch {
    return { workspaces: {} };
  }
}

function saveConfig(repoRoot, cfg) {
  const p = configPath(repoRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8');
}

function resolveFolderPath(folderPath) {
  const raw = String(folderPath || '').trim();
  if (!raw) return null;
  const resolved = path.resolve(raw);
  if (!path.isAbsolute(resolved)) return null;

  const rootEnv = process.env.FORGE_DETECTION_EXPORT_ROOT;
  if (rootEnv && String(rootEnv).trim()) {
    const rootResolved = path.resolve(String(rootEnv).trim());
    if (!(resolved === rootResolved || resolved.startsWith(rootResolved + path.sep))) {
      return null;
    }
  }
  return resolved;
}

function appendJsonl(folder, lineObj) {
  const jsonlPath = path.join(folder, 'events.jsonl');
  const line = JSON.stringify(lineObj) + '\n';
  fs.appendFileSync(jsonlPath, line, 'utf8');
}

function hasGraphicalSession() {
  if (process.platform === 'win32') return true;
  if (process.platform === 'darwin') return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

/** Opens the OS folder picker on the machine running auth-server (board / dev PC). */
async function pickFolderNative(title) {
  const prompt = String(title || 'Select export folder');

  if (process.platform === 'linux') {
    if (!hasGraphicalSession()) {
      throw new Error('No display session — connect a screen or set DISPLAY for the folder dialog.');
    }
    try {
      const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':0' };
      const { stdout } = await execFileAsync(
        'zenity',
        ['--file-selection', '--directory', `--title=${prompt}`],
        { timeout: 0, maxBuffer: 1024 * 1024, env },
      );
      const picked = String(stdout || '').trim();
      return picked || null;
    } catch (e) {
      if (e && (e.code === 1 || e.killed)) return null;
      try {
        const startDir = process.env.HOME || '/';
        const { stdout } = await execFileAsync(
          'kdialog',
          ['--getexistingdirectory', startDir, '--title', prompt],
          { timeout: 0, maxBuffer: 1024 * 1024 },
        );
        const picked = String(stdout || '').trim();
        return picked || null;
      } catch (e2) {
        if (e2 && (e2.code === 1 || e2.killed)) return null;
        throw new Error('Install zenity or kdialog to choose a folder from the UI.');
      }
    }
  }

  if (process.platform === 'darwin') {
    const script =
      'POSIX path of (choose folder with prompt "' + prompt.replace(/"/g, '\\"') + '")';
    try {
      const { stdout } = await execFileAsync('osascript', ['-e', script], {
        timeout: 0,
        maxBuffer: 1024 * 1024,
      });
      const picked = String(stdout || '').trim();
      return picked || null;
    } catch (e) {
      if (e && e.code === 1) return null;
      throw e;
    }
  }

  if (process.platform === 'win32') {
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
      `$d.Description = '${prompt.replace(/'/g, "''")}'`,
      'if ($d.ShowDialog() -eq "OK") { Write-Output $d.SelectedPath }',
    ].join('; ');
    try {
      const { stdout } = await execFileAsync(
        'powershell',
        ['-NoProfile', '-STA', '-Command', ps],
        { timeout: 0, maxBuffer: 1024 * 1024 },
      );
      const picked = String(stdout || '').trim();
      return picked || null;
    } catch (e) {
      if (e && e.code === 1) return null;
      throw e;
    }
  }

  throw new Error('Native folder picker is not supported on this OS.');
}

function assignWorkspaceFolder(repoRoot, workspaceId, folderPathRaw) {
  const resolved = resolveFolderPath(folderPathRaw);
  if (!resolved) {
    const hint = process.env.FORGE_DETECTION_EXPORT_ROOT
      ? `Path must be under ${process.env.FORGE_DETECTION_EXPORT_ROOT}`
      : 'Invalid folder path';
    return { ok: false, error: hint };
  }
  try {
    fs.mkdirSync(resolved, { recursive: true });
    fs.accessSync(resolved, fs.constants.W_OK);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Folder is not writable',
    };
  }
  const cfg = loadConfig(repoRoot);
  if (!cfg.workspaces) cfg.workspaces = {};
  cfg.workspaces[workspaceId] = { folderPath: resolved, updatedAt: Date.now() };
  saveConfig(repoRoot, cfg);
  return { ok: true, workspaceId, folderPath: resolved };
}

/** POST /api/detection-export/pick-folder — also mounted on auth-server app directly. */
function handlePickFolder(repoRoot) {
  return async (req, res) => {
    const workspaceId = String(req.body?.workspaceId || '').trim();
    if (!WORKSPACE_IDS.has(workspaceId)) {
      return res.status(400).json({ ok: false, error: 'Invalid workspaceId' });
    }

    const title =
      typeof req.body?.title === 'string' && req.body.title.trim()
        ? req.body.title.trim()
        : 'Select export folder';

    try {
      const picked = await pickFolderNative(title);
      if (!picked) return res.json({ ok: false, aborted: true });
      const result = assignWorkspaceFolder(repoRoot, workspaceId, picked);
      if (!result.ok) return res.status(400).json(result);
      return res.json(result);
    } catch (e) {
      return res.status(503).json({
        ok: false,
        error: e instanceof Error ? e.message : 'Could not open folder picker',
        manualPath: true,
      });
    }
  };
}

function createDetectionExportRouter(repoRoot) {
  const router = express.Router();

  router.get('/status', (_req, res) => {
    res.json({
      ok: true,
      serverExport: true,
      apiVersion: 2,
      nativePicker: hasGraphicalSession(),
      restrictedRoot: Boolean(process.env.FORGE_DETECTION_EXPORT_ROOT?.trim()),
    });
  });

  router.get('/folders', (_req, res) => {
    const cfg = loadConfig(repoRoot);
    res.json({ ok: true, workspaces: cfg.workspaces || {} });
  });

  router.put('/folders', async (req, res) => {
    const workspaceId = String(req.body?.workspaceId || '').trim();
    if (!WORKSPACE_IDS.has(workspaceId)) {
      return res.status(400).json({ ok: false, error: 'Invalid workspaceId' });
    }

    if (req.body?.openPicker === true) {
      const title =
        typeof req.body?.title === 'string' && req.body.title.trim()
          ? req.body.title.trim()
          : 'Select export folder';
      try {
        const picked = await pickFolderNative(title);
        if (!picked) return res.json({ ok: false, aborted: true });
        const result = assignWorkspaceFolder(repoRoot, workspaceId, picked);
        if (!result.ok) return res.status(400).json(result);
        return res.json(result);
      } catch (e) {
        return res.status(503).json({
          ok: false,
          error: e instanceof Error ? e.message : 'Could not open folder picker',
        });
      }
    }

    const cfg = loadConfig(repoRoot);
    if (!cfg.workspaces) cfg.workspaces = {};

    const folderPathRaw = req.body?.folderPath;
    if (folderPathRaw == null || String(folderPathRaw).trim() === '') {
      delete cfg.workspaces[workspaceId];
      saveConfig(repoRoot, cfg);
      return res.json({ ok: true, workspaceId, folderPath: null });
    }

    const result = assignWorkspaceFolder(repoRoot, workspaceId, folderPathRaw);
    if (!result.ok) return res.status(400).json(result);
    return res.json(result);
  });

  router.post('/pick-folder', express.json(), handlePickFolder(repoRoot));

  /** JSON body: { workspaceId, event, cropBase64 } */
  router.post('/event', express.json({ limit: '12mb' }), (req, res) => {
    const workspaceId = String(req.body?.workspaceId || '').trim();
    if (!WORKSPACE_IDS.has(workspaceId)) {
      return res.status(400).json({ ok: false, error: 'Invalid workspaceId' });
    }

    const cfg = loadConfig(repoRoot);
    const entry = cfg.workspaces?.[workspaceId];
    if (!entry?.folderPath) {
      return res.status(404).json({ ok: false, error: 'No export folder configured for this workspace' });
    }

    const folder = entry.folderPath;
    const ev = req.body?.event;
    const cropB64 = req.body?.cropBase64;
    if (!ev || typeof ev !== 'object' || typeof cropB64 !== 'string' || !cropB64.trim()) {
      return res.status(400).json({ ok: false, error: 'event and cropBase64 required' });
    }

    try {
      fs.mkdirSync(folder, { recursive: true });
      const createdAt = typeof ev.createdAt === 'number' ? ev.createdAt : Date.now();
      const id = String(ev.id || `${createdAt}`);
      const jpgName = `det-${createdAt}-${id}.jpg`;
      const buf = Buffer.from(cropB64, 'base64');
      fs.writeFileSync(path.join(folder, jpgName), buf);

      const lineObj = { ...ev };
      delete lineObj.cropImage;
      lineObj.image = jpgName;
      appendJsonl(folder, lineObj);

      return res.json({ ok: true, image: jpgName });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : 'Failed to write detection export',
      });
    }
  });

  return router;
}

module.exports = { createDetectionExportRouter, handlePickFolder, WORKSPACE_IDS };
