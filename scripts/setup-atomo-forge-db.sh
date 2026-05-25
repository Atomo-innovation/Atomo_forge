#!/usr/bin/env bash
# Create and migrate the standalone detection-events MySQL database (atomo_forge).
# Not MeshCentral — see scripts/sql/events/README.md
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${REPO_ROOT}/.env"
  set +a
fi

EVENTS_DB="${MYSQL_EVENTS_DATABASE:-atomo_forge}"
EVENTS_HOST="${MYSQL_EVENTS_HOST:-${MYSQL_HOST:-127.0.0.1}}"
EVENTS_PORT="${MYSQL_EVENTS_PORT:-${MYSQL_PORT:-3307}}"
GRANT_SQL="${REPO_ROOT}/scripts/sql/grant-atomo-forge.sql"
KEY="${FORGE_EC2_SSH_KEY:-$HOME/Downloads/atomo_web.pem}"
EC2_HOST="${FORGE_EC2_HOST:-65.2.142.160}"
EC2_USER="${FORGE_EC2_USER:-ubuntu}"

echo "=== atomo_forge setup (new MySQL database for detection events) ==="
echo "  database: ${EVENTS_DB}"
echo "  connect:  ${EVENTS_HOST}:${EVENTS_PORT}"
echo ""

port_open() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -E "(^|:)${EVENTS_PORT}$" -q
  else
    false
  fi
}

if ! port_open; then
  echo "[1/4] MySQL port ${EVENTS_PORT} is not open on this machine."
  echo "      Start the tunnel in another terminal (keep it running):"
  echo "        npm run mysql:tunnel"
  echo ""
  echo "      Or point MYSQL_EVENTS_HOST/PORT at your own MySQL server in .env"
  exit 1
fi
echo "[1/4] Port ${EVENTS_PORT} is listening — OK"

echo ""
echo "[2/4] Create database + grants on the MySQL SERVER (one-time, as admin)"
echo "      Run this from the repo (needs SSH key to EC2):"
echo ""
echo "  npm run grant:events-db"
echo ""
read -r -p "Run grant on EC2 now? [y/N] " ans
if [[ "${ans}" =~ ^[Yy]$ ]]; then
  bash "${SCRIPT_DIR}/grant-atomo-forge-on-ec2.sh"
else
  echo "Skipped — run: npm run grant:events-db"
fi

echo ""
echo "[3/4] Apply tables (detection_events + image_jpeg in MySQL)..."
if ! npm run migrate:events; then
  echo "migrate:events failed — complete step 2 (grant) then retry." >&2
  exit 1
fi

echo ""
echo "[4/4] Verify connection..."
node -e "
const { eventsMysqlConfig } = require('./scripts/events-mysql-config.cjs');
const mysql = require('mysql2/promise');
(async () => {
  const c = eventsMysqlConfig();
  const conn = await mysql.createConnection({ ...c, database: c.database });
  const [t] = await conn.query('SHOW TABLES LIKE \"detection_events\"');
  const [n] = await conn.query('SELECT COUNT(*) AS n FROM detection_events');
  console.log('  table detection_events:', t.length ? 'yes' : 'MISSING');
  console.log('  row count:', n[0].n);
  await conn.end();
})().catch((e) => { console.error('  FAILED:', e.message); process.exit(1); });
"

echo ""
echo "Done. Start the app: npm run dev   (or npm run board:go on the board)"
echo "Check API: curl -s http://localhost:3003/api/detection-events/status"
