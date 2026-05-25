/**
 * Connection settings for the standalone detection-events MySQL (atomo_forge).
 * Falls back to MYSQL_HOST/PORT when MYSQL_EVENTS_* is unset (same server, different database).
 */
require('../load-env.cjs');

function eventsMysqlConfig() {
  const host = process.env.MYSQL_EVENTS_HOST || process.env.MYSQL_HOST || '127.0.0.1';
  const port = parseInt(process.env.MYSQL_EVENTS_PORT || process.env.MYSQL_PORT || '3306', 10);
  const user = process.env.MYSQL_EVENTS_USER || process.env.MYSQL_USER || 'atomo';
  const password = process.env.MYSQL_EVENTS_PASSWORD || process.env.MYSQL_PASSWORD || 'atomo@1234';
  const database = process.env.MYSQL_EVENTS_DATABASE || 'atomo_forge';
  const connectTimeout = parseInt(process.env.MYSQL_CONNECT_TIMEOUT_MS || '10000', 10);
  return { host, port, user, password, database, connectTimeout };
}

module.exports = { eventsMysqlConfig };
