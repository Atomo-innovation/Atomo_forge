#!/usr/bin/env bash
# Create 4 event databases on LOCAL MySQL (when EC2 SSH is unreachable).
# Uses sudo mysql on this machine — for board/laptop with local mysqld.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL="${ROOT}/scripts/sql/grant-atomo-forge.sql"

echo "[grant:local] Creating atomo_forge_* databases on this machine..."

if command -v sudo >/dev/null 2>&1 && sudo mysql -e "SELECT 1" >/dev/null 2>&1; then
  sudo mysql < "${SQL}"
elif mysql -u root -e "SELECT 1" >/dev/null 2>&1; then
  mysql -u root < "${SQL}"
elif mysql -e "SELECT 1" >/dev/null 2>&1; then
  mysql < "${SQL}"
else
  echo "[grant:local] Cannot run mysql. Install MySQL or fix EC2 SSH and use: npm run grant:events-db" >&2
  exit 1
fi

echo "[grant:local] Grant atomo user (adjust if your user is different)..."
for db in atomo_forge_person atomo_forge_fire atomo_forge_face atomo_forge_safety; do
  sudo mysql -e "GRANT ALL ON \`${db}\`.* TO 'atomo'@'localhost';" 2>/dev/null \
    || mysql -u root -e "GRANT ALL ON \`${db}\`.* TO 'atomo'@'localhost';" 2>/dev/null \
    || true
done
sudo mysql -e "FLUSH PRIVILEGES;" 2>/dev/null || mysql -u root -e "FLUSH PRIVILEGES;" 2>/dev/null || true

echo "[grant:local] Done. Set in .env:"
echo "  MYSQL_EVENTS_HOST=127.0.0.1"
echo "  MYSQL_EVENTS_PORT=3306"
echo "  FORGE_SKIP_MYSQL_TUNNEL=1   # optional — skip EC2 tunnel in npm run dev"
echo ""
echo "Then: npm run migrate:events && npm run dev"
