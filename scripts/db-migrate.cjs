/**
 * MySQL schema migration runner for atomo-forge-suite.
 *
 *   • scripts/sql/*.sql        → MYSQL_DATABASE (meshcentral — login, devices)
 *   • scripts/sql/events/*.sql → MYSQL_EVENTS_DATABASE (atomo_forge — detections + images)
 */
require('../load-env.cjs');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { eventsMysqlConfig } = require('./events-mysql-config.cjs');

const SQL_DIR = path.join(__dirname, 'sql');
const EVENTS_SQL_DIR = path.join(SQL_DIR, 'events');

function mysqlBaseConfig() {
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'atomo',
    password: process.env.MYSQL_PASSWORD || 'atomo@1234',
    multipleStatements: true,
    connectTimeout: parseInt(process.env.MYSQL_CONNECT_TIMEOUT_MS || '10000', 10),
  };
}

function eventsMigrateConfig() {
  const c = eventsMysqlConfig();
  return {
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    multipleStatements: true,
    connectTimeout: c.connectTimeout,
  };
}

function listSqlFiles(dir) {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.sql'))
      .sort();
    return { files };
  } catch (e) {
    return { error: e.message, files: [] };
  }
}

async function applySqlFiles({ database, files, dir, log, warn, connectionConfig }) {
  if (!files.length) return { ok: true, ran: [], skipped: true };

  const cfg = connectionConfig || mysqlBaseConfig();
  if (database) cfg.database = database;

  let conn;
  try {
    conn = await mysql.createConnection(cfg);
  } catch (e) {
    warn(
      `[migrate] cannot connect to MySQL at ${cfg.host}:${cfg.port}` +
        (database ? ` db=${database}` : '') +
        ` (${e.code || e.message})`,
    );
    return { ok: false, error: e.code || e.message, ran: [] };
  }

  const ran = [];
  try {
    for (const file of files) {
      const full = path.join(dir, file);
      const sql = fs.readFileSync(full, 'utf8').trim();
      if (!sql) continue;
      log(`[migrate] applying ${database ? database + '/' : ''}${file}`);
      await conn.query(sql);
      ran.push(file);
    }
    return { ok: true, ran };
  } catch (e) {
    warn(`[migrate] FAILED (${database || 'no-db'}): ${e.code || e.message}`);
    return { ok: false, error: e.code || e.message, ran };
  } finally {
    try {
      await conn.end();
    } catch (_) {
      /* ignore */
    }
  }
}

async function runMigrations({ log = console.log, warn = console.warn } = {}) {
  const meshDb = process.env.MYSQL_DATABASE || 'meshcentral';
  const eventsDb = process.env.MYSQL_EVENTS_DATABASE || 'atomo_forge';
  const cfg = mysqlBaseConfig();

  const meshList = listSqlFiles(SQL_DIR);
  if (meshList.error) {
    warn(`[migrate] cannot read ${SQL_DIR}: ${meshList.error}`);
  }

  const eventsList = listSqlFiles(EVENTS_SQL_DIR);
  if (eventsList.error) {
    warn(`[migrate] cannot read ${EVENTS_SQL_DIR}: ${eventsList.error}`);
  }

  const meshFiles = meshList.files || [];
  const eventsFiles = eventsList.files || [];

  let allOk = true;
  const allRan = [];

  if (meshFiles.length) {
    const r = await applySqlFiles({
      database: meshDb,
      files: meshFiles,
      dir: SQL_DIR,
      log,
      warn,
    });
    allRan.push(...r.ran.map((f) => `${meshDb}/${f}`));
    if (!r.ok) allOk = false;
  }

  if (eventsFiles.length) {
    // No default database — script contains CREATE DATABASE + USE atomo_forge
    const r = await applySqlFiles({
      database: null,
      files: eventsFiles,
      dir: EVENTS_SQL_DIR,
      log,
      warn,
      connectionConfig: eventsMigrateConfig(),
    });
    allRan.push(...r.ran.map((f) => `${eventsDb}/${f}`));
    if (!r.ok) allOk = false;
  } else {
    log(`[migrate] no files in ${EVENTS_SQL_DIR}`);
  }

  if (allOk) {
    log(
      `[migrate] done — ${allRan.length} file(s) at ${cfg.host}:${cfg.port}` +
        ` (mesh=${meshDb}, events=${eventsDb})`,
    );
  }

  return { ok: allOk, ran: allRan, meshDatabase: meshDb, eventsDatabase: eventsDb };
}

async function runEventsMigrations(opts) {
  const { database: eventsDb, host, port } = eventsMysqlConfig();
  const list = listSqlFiles(EVENTS_SQL_DIR);
  if (!list.files || !list.files.length) {
    return { ok: true, ran: [], eventsDatabase: eventsDb };
  }
  const log = (opts && opts.log) || console.log;
  const warn = (opts && opts.warn) || console.warn;
  const r = await applySqlFiles({
    database: null,
    files: list.files,
    dir: EVENTS_SQL_DIR,
    log,
    warn,
    connectionConfig: eventsMigrateConfig(),
  });
  return { ...r, eventsDatabase: eventsDb, host, port };
}

module.exports = { runMigrations, runEventsMigrations };

if (require.main === module) {
  runMigrations().then((r) => {
    process.exit(r.ok ? 0 : 1);
  });
}
