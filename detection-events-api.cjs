/**
 * Detection events — one MySQL database per workspace (Person / Fire / Face / Safety).
 */
const express = require('express');
const multer = require('multer');
const {
  databaseForWorkspace,
  isValidWorkspace,
  allWorkspaceDatabases,
} = require('./scripts/events-mysql-config.cjs');

const TABLE = 'detection_events';
const MAX_SEARCH_LIMIT = 500;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const LIST_COLUMNS = `id, created_at_ms, detection_workspace, camera_id, camera_name, model_name,
  label, score, session_id, box_json`;

function parseForgeAccount(source) {
  const raw =
    source?.forgeAccount ?? source?.accountId ?? source?.account ?? source?.meshUsername;
  const s = String(raw || '').trim().toLowerCase();
  return s || null;
}

function parseWorkspace(source) {
  const ws = String(source?.workspace ?? source?.detectionWorkspace ?? '').trim();
  return isValidWorkspace(ws) ? ws : null;
}

const tableReadyByDb = new Map();

function resetTableCache() {
  tableReadyByDb.clear();
}

async function ensureTable(pool, dbName) {
  if (tableReadyByDb.get(dbName) === true) return true;
  if (tableReadyByDb.get(dbName) === false) return false;
  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.tables
       WHERE table_schema = ? AND table_name = ?`,
      [dbName, TABLE],
    );
    const ok = rows && rows[0] && Number(rows[0].c) > 0;
    tableReadyByDb.set(dbName, ok);
    return ok;
  } catch {
    tableReadyByDb.set(dbName, false);
    return false;
  }
}

function rowToEvent(row, workspace) {
  let box;
  if (row.box_json != null) {
    try {
      box = typeof row.box_json === 'string' ? JSON.parse(row.box_json) : row.box_json;
    } catch {
      box = undefined;
    }
  }
  return {
    id: String(row.id),
    createdAt: Number(row.created_at_ms),
    sessionId: row.session_id ? String(row.session_id) : '',
    cameraId: String(row.camera_id),
    detectionWorkspace: row.detection_workspace ? String(row.detection_workspace) : workspace,
    cameraName: row.camera_name ? String(row.camera_name) : undefined,
    modelName: row.model_name ? String(row.model_name) : undefined,
    label: String(row.label),
    score: row.score == null ? undefined : Number(row.score),
    box,
    imageFromServer: true,
  };
}

function poolForRequest(eventsPools, workspace) {
  const ws = parseWorkspace({ workspace });
  if (!ws) return { error: 'workspace query parameter required (cameras|cameras2|cameras3|cameras4)' };
  const pool = eventsPools.getPool(ws);
  const dbName = databaseForWorkspace(ws);
  if (!pool || !dbName) return { error: 'Invalid workspace' };
  return { pool, dbName, workspace: ws };
}

function registerDetectionEventsRoutes(app, { eventsPools }) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES },
  });

  app.get('/api/detection-events/status', async (_req, res) => {
    const workspaces = [];
    for (const { workspaceId, label, database } of allWorkspaceDatabases()) {
      const pool = eventsPools.getPool(workspaceId);
      const ok = pool ? await ensureTable(pool, database) : false;
      workspaces.push({ workspaceId, label, database, dbAvailable: ok });
    }
    const dbAvailable = workspaces.every((w) => w.dbAvailable);
    return res.json({
      ok: true,
      dbAvailable,
      storage: 'mysql_blob',
      meshCentralRequired: false,
      workspaces,
    });
  });

  app.post('/api/detection-events/event', upload.single('crop'), async (req, res) => {
    try {
      const workspace = parseWorkspace(req.body);
      if (!workspace) {
        return res.status(400).json({ ok: false, error: 'detectionWorkspace required' });
      }
      const ctx = poolForRequest(eventsPools, workspace);
      if (ctx.error) return res.status(400).json({ ok: false, error: ctx.error });

      if (!(await ensureTable(ctx.pool, ctx.dbName))) {
        return res.status(503).json({
          ok: false,
          error: `Database ${ctx.dbName} not ready. Run: npm run migrate:events`,
        });
      }

      const forgeAccount = parseForgeAccount(req.body);
      if (!forgeAccount) {
        return res.status(400).json({ ok: false, error: 'forgeAccount required' });
      }

      const id = String(req.body?.id || '').trim();
      const createdAtMs = parseInt(String(req.body?.createdAtMs || req.body?.createdAt || ''), 10);
      const cameraId = String(req.body?.cameraId || '').trim();
      const label = String(req.body?.label || '').trim();

      if (!id || !Number.isFinite(createdAtMs) || !cameraId || !label) {
        return res.status(400).json({ ok: false, error: 'id, createdAtMs, cameraId, and label required' });
      }
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ ok: false, error: 'crop image required' });
      }

      let boxJson = null;
      if (req.body?.boxJson) {
        try {
          boxJson =
            typeof req.body.boxJson === 'string' ? req.body.boxJson : JSON.stringify(req.body.boxJson);
        } catch {
          boxJson = null;
        }
      }
      const scoreRaw = req.body?.score;
      const score = scoreRaw === '' || scoreRaw == null ? null : Number(scoreRaw);

      await ctx.pool.query(
        `INSERT INTO ${TABLE}
          (id, forge_account, created_at_ms, detection_workspace, camera_id, camera_name, model_name,
           label, score, session_id, box_json, image_jpeg)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          created_at_ms = VALUES(created_at_ms),
          camera_id = VALUES(camera_id),
          camera_name = VALUES(camera_name),
          model_name = VALUES(model_name),
          label = VALUES(label),
          score = VALUES(score),
          session_id = VALUES(session_id),
          box_json = VALUES(box_json),
          image_jpeg = VALUES(image_jpeg)`,
        [
          id,
          forgeAccount,
          createdAtMs,
          workspace,
          cameraId,
          req.body?.cameraName ? String(req.body.cameraName) : null,
          req.body?.modelName ? String(req.body.modelName) : null,
          label,
          Number.isFinite(score) ? score : null,
          req.body?.sessionId ? String(req.body.sessionId) : null,
          boxJson,
          req.file.buffer,
        ],
      );

      return res.json({ ok: true, id, database: ctx.dbName, workspace });
    } catch (e) {
      console.warn('[detection-events] POST failed:', e && (e.code || e.message));
      if (e?.code === 'ER_DBACCESS_DENIED_ERROR') resetTableCache();
      return res.status(500).json({ ok: false, error: e?.message || 'Failed to save event' });
    }
  });

  app.get('/api/detection-events/search', async (req, res) => {
    try {
      const workspace = parseWorkspace(req.query);
      if (!workspace) {
        return res.status(400).json({ ok: false, error: 'workspace query parameter required' });
      }
      const ctx = poolForRequest(eventsPools, workspace);
      if (ctx.error) return res.status(400).json({ ok: false, error: ctx.error });

      if (!(await ensureTable(ctx.pool, ctx.dbName))) {
        return res.json({ ok: true, dbAvailable: false, events: [], database: ctx.dbName, workspace });
      }

      const forgeAccount = parseForgeAccount(req.query);
      if (!forgeAccount) {
        return res.status(400).json({ ok: false, error: 'forgeAccount required' });
      }

      const q = String(req.query.q || '').trim();
      const fromMs = parseInt(String(req.query.fromMs || ''), 10);
      const toMs = parseInt(String(req.query.toMs || ''), 10);
      let limit = parseInt(String(req.query.limit || '200'), 10);
      if (!Number.isFinite(limit) || limit < 1) limit = 200;
      limit = Math.min(limit, MAX_SEARCH_LIMIT);

      const cameraIdsRaw = String(req.query.cameraIds || '').trim();
      const cameraIds = cameraIdsRaw
        ? cameraIdsRaw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 64)
        : [];

      let sql = `SELECT ${LIST_COLUMNS} FROM ${TABLE} WHERE forge_account = ?`;
      const params = [forgeAccount];

      if (cameraIds.length) {
        sql += ` AND camera_id IN (${cameraIds.map(() => '?').join(',')})`;
        params.push(...cameraIds);
      }
      if (Number.isFinite(fromMs)) {
        sql += ` AND created_at_ms >= ?`;
        params.push(fromMs);
      }
      if (Number.isFinite(toMs)) {
        sql += ` AND created_at_ms <= ?`;
        params.push(toMs);
      }
      if (q) {
        const safeQ = q.replace(/[%_]/g, '');
        const like = `%${safeQ}%`;
        sql += ` AND (
          label LIKE ? OR camera_name LIKE ? OR model_name LIKE ? OR camera_id LIKE ?
          OR session_id LIKE ?
          OR DATE_FORMAT(FROM_UNIXTIME(created_at_ms / 1000), '%d/%m/%Y %H:%i') LIKE ?
          OR DATE_FORMAT(FROM_UNIXTIME(created_at_ms / 1000), '%b %d, %Y') LIKE ?
          OR DATE_FORMAT(FROM_UNIXTIME(created_at_ms / 1000), '%Y-%m-%d') LIKE ?
        )`;
        params.push(like, like, like, like, like, like, like, like);
      }

      sql += ` ORDER BY created_at_ms DESC LIMIT ?`;
      params.push(limit);

      const [rows] = await ctx.pool.query(sql, params);
      return res.json({
        ok: true,
        dbAvailable: true,
        events: (rows || []).map((r) => rowToEvent(r, workspace)),
        database: ctx.dbName,
        workspace,
      });
    } catch (e) {
      console.warn('[detection-events] search failed:', e && (e.code || e.message));
      return res.status(500).json({ ok: false, error: e?.message || 'Search failed' });
    }
  });

  app.get('/api/detection-events/:id/image', async (req, res) => {
    try {
      const workspace = parseWorkspace(req.query);
      if (!workspace) return res.status(400).send('workspace required');

      const ctx = poolForRequest(eventsPools, workspace);
      if (ctx.error) return res.status(400).send(ctx.error);

      const forgeAccount = parseForgeAccount(req.query);
      const id = String(req.params.id || '').trim();
      if (!forgeAccount || !id) return res.status(400).send('forgeAccount and id required');

      const [rows] = await ctx.pool.query(
        `SELECT image_jpeg FROM ${TABLE} WHERE forge_account = ? AND id = ? LIMIT 1`,
        [forgeAccount, id],
      );
      const buf = rows?.[0]?.image_jpeg;
      if (!buf?.length) return res.status(404).send('Image not found');

      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.send(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
    } catch (e) {
      console.warn('[detection-events] image failed:', e?.message);
      return res.status(500).send('Error');
    }
  });
}

module.exports = { registerDetectionEventsRoutes, resetTableCache };
