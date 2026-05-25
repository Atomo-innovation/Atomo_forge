#!/usr/bin/env bash
# Create atomo_forge and GRANT to every existing MySQL user named 'atomo' (any host).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi

KEY="${FORGE_EC2_SSH_KEY:-$HOME/Downloads/atomo_web.pem}"
KEY="${KEY/#\~/$HOME}"
EC2_HOST="${FORGE_EC2_HOST:-65.2.142.160}"
EC2_USER="${FORGE_EC2_USER:-ubuntu}"
EVENTS_DB="${MYSQL_EVENTS_DATABASE:-atomo_forge}"

if [[ ! -f "${KEY}" ]]; then
  echo "SSH key not found: ${KEY}" >&2
  exit 1
fi

echo "[grant] Creating database ${EVENTS_DB} on EC2..."
ssh -i "${KEY}" -o StrictHostKeyChecking=accept-new "${EC2_USER}@${EC2_HOST}" \
  'sudo mysql' < "${REPO_ROOT}/scripts/sql/grant-atomo-forge.sql"

echo "[grant] Listing existing MySQL accounts named atomo..."
ssh -i "${KEY}" "${EC2_USER}@${EC2_HOST}" "sudo mysql -N -e \"SELECT user, host FROM mysql.user WHERE user='atomo';\""

echo "[grant] Applying GRANT for each atomo@host..."
ssh -i "${KEY}" "${EC2_USER}@${EC2_HOST}" bash -s "${EVENTS_DB}" <<'REMOTE'
set -euo pipefail
DB="$1"
while IFS=$'\t' read -r u h; do
  [[ -z "${u:-}" ]] && continue
  echo "  GRANT on ${DB}.* -> '${u}'@'${h}'"
  sudo mysql -e "GRANT ALL PRIVILEGES ON \`${DB}\`.* TO '${u}'@'${h}';"
done < <(sudo mysql -N -e "SELECT user, host FROM mysql.user WHERE user='atomo';")
sudo mysql -e "FLUSH PRIVILEGES;"
echo "[grant] Done. Databases:"
sudo mysql -e "SHOW DATABASES LIKE '${DB}';"
REMOTE

echo ""
echo "On your laptop (tunnel running): npm run migrate:events"
echo "Then: mysql -h 127.0.0.1 -P 3307 -u atomo -p -e \"USE ${EVENTS_DB}; SHOW TABLES;\""
