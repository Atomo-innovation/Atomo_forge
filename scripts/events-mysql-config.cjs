/**
 * Four separate MySQL databases for detection workspaces (not MeshCentral).
 */
require('../load-env.cjs');

const WORKSPACE_IDS = ['cameras', 'cameras2', 'cameras3', 'cameras4'];

const WORKSPACE_DATABASES = {
  cameras: process.env.MYSQL_EVENTS_DB_PERSON || 'atomo_forge_person',
  cameras2: process.env.MYSQL_EVENTS_DB_FIRE || 'atomo_forge_fire',
  cameras3: process.env.MYSQL_EVENTS_DB_FACE || 'atomo_forge_face',
  cameras4: process.env.MYSQL_EVENTS_DB_SAFETY || 'atomo_forge_safety',
};

const WORKSPACE_LABELS = {
  cameras: 'Person',
  cameras2: 'Fire & Smoke',
  cameras3: 'Face recognition',
  cameras4: 'Safety',
};

function eventsMysqlBaseConfig() {
  return {
    host: process.env.MYSQL_EVENTS_HOST || process.env.MYSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MYSQL_EVENTS_PORT || process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_EVENTS_USER || process.env.MYSQL_USER || 'atomo',
    password: process.env.MYSQL_EVENTS_PASSWORD || process.env.MYSQL_PASSWORD || 'atomo@1234',
    connectTimeout: parseInt(process.env.MYSQL_CONNECT_TIMEOUT_MS || '10000', 10),
  };
}

function databaseForWorkspace(workspaceId) {
  const ws = String(workspaceId || '').trim();
  return WORKSPACE_DATABASES[ws] || null;
}

function isValidWorkspace(workspaceId) {
  return WORKSPACE_IDS.includes(String(workspaceId || '').trim());
}

function allWorkspaceDatabases() {
  return WORKSPACE_IDS.map((id) => ({ workspaceId: id, label: WORKSPACE_LABELS[id], database: WORKSPACE_DATABASES[id] }));
}

/** @param {typeof import('mysql2/promise')} mysql */
function createEventsPoolManager(mysql) {
  const pools = new Map();
  const base = eventsMysqlBaseConfig();

  return {
    databaseForWorkspace,
    isValidWorkspace,
    allWorkspaceDatabases,
    getPool(workspaceId) {
      const db = databaseForWorkspace(workspaceId);
      if (!db) return null;
      if (!pools.has(db)) {
        pools.set(
          db,
          mysql.createPool({
            ...base,
            database: db,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
          }),
        );
      }
      return pools.get(db);
    },
  };
}

/** @deprecated single-DB helper — use databaseForWorkspace */
function eventsMysqlConfig() {
  const base = eventsMysqlBaseConfig();
  return { ...base, database: process.env.MYSQL_EVENTS_DATABASE || WORKSPACE_DATABASES.cameras };
}

module.exports = {
  WORKSPACE_IDS,
  WORKSPACE_DATABASES,
  WORKSPACE_LABELS,
  eventsMysqlBaseConfig,
  eventsMysqlConfig,
  databaseForWorkspace,
  isValidWorkspace,
  allWorkspaceDatabases,
  createEventsPoolManager,
};
