/**
 * MySQL schema migration runner for atomo-forge-suite.
 *
 *   • Loads .env (so MYSQL_* vars are available).
 *   • Reads every *.sql file in scripts/sql/ (sorted by filename).
 *   • Executes each file as a multi-statement script against MYSQL_DATABASE.
 *
 * The files are written with `CREATE TABLE IF NOT EXISTS` etc. so they're
 * idempotent — safe to run on every boot and from `npm run migrate`.
 *
 * Used by:
 *   • auth-server.cjs at startup (via runMigrations()), so a fresh dev box
 *     just works without remembering to migrate.
 *   • `npm run migrate` as a manual fallback.
 */
require('../load-env.cjs');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const SQL_DIR = path.join(__dirname, 'sql');

async function runMigrations({ log = console.log, warn = console.warn } = {}) {
  let files;
  try {
    files = fs
      .readdirSync(SQL_DIR)
      .filter((f) => f.toLowerCase().endsWith('.sql'))
      .sort();
  } catch (e) {
    warn(`[migrate] cannot read ${SQL_DIR}: ${e.message}`);
    return { ok: false, error: e.message, ran: [] };
  }
  if (files.length === 0) {
    log('[migrate] no .sql files in scripts/sql/, nothing to do');
    return { ok: true, ran: [] };
  }

  const host = process.env.MYSQL_HOST || '127.0.0.1';
  const port = parseInt(process.env.MYSQL_PORT || '3306', 10);
  const user = process.env.MYSQL_USER || 'atomo';
  const password = process.env.MYSQL_PASSWORD || 'atomo@1234';
  const database = process.env.MYSQL_DATABASE || 'meshcentral';

  let conn;
  try {
    conn = await mysql.createConnection({
      host,
      port,
      user,
      password,
      database,
      multipleStatements: true,
      connectTimeout: parseInt(process.env.MYSQL_CONNECT_TIMEOUT_MS || '10000', 10),
    });
  } catch (e) {
    warn(`[migrate] cannot connect to MySQL at ${host}:${port} (${e.code || e.message}). Skipping migrations.`);
    return { ok: false, error: e.code || e.message, ran: [] };
  }

  const ran = [];
  try {
    for (const file of files) {
      const full = path.join(SQL_DIR, file);
      const sql = fs.readFileSync(full, 'utf8').trim();
      if (!sql) continue;
      log(`[migrate] applying ${file}`);
      await conn.query(sql);
      ran.push(file);
    }
    log(`[migrate] done — applied ${ran.length} file(s) against ${database}@${host}:${port}`);
    return { ok: true, ran };
  } catch (e) {
    warn(`[migrate] FAILED on ${ran.length > 0 ? ran[ran.length - 1] : '(first file)'}: ${e.code || e.message}`);
    return { ok: false, error: e.code || e.message, ran };
  } finally {
    try { await conn.end(); } catch (_) { /* ignore */ }
  }
}

module.exports = { runMigrations };

if (require.main === module) {
  runMigrations().then((r) => {
    process.exit(r.ok ? 0 : 1);
  });
}
