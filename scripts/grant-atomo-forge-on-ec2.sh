#!/usr/bin/env bash
# Create four workspace DBs and GRANT atomo@* on each.
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

DATABASES=(
  "${MYSQL_EVENTS_DB_PERSON:-atomo_forge_person}"
  "${MYSQL_EVENTS_DB_FIRE:-atomo_forge_fire}"
  "${MYSQL_EVENTS_DB_FACE:-atomo_forge_face}"
  "${MYSQL_EVENTS_DB_SAFETY:-atomo_forge_safety}"
)

if [[ ! -f "${KEY}" ]]; then
  echo "SSH key not found: ${KEY}" >&2
  exit 1
fi

echo "[grant] Creating workspace databases on EC2..."
ssh -i "${KEY}" -o StrictHostKeyChecking=accept-new "${EC2_USER}@${EC2_HOST}" \
  'sudo mysql' < "${REPO_ROOT}/scripts/sql/grant-atomo-forge.sql"

echo "[grant] Listing atomo MySQL accounts..."
ssh -i "${KEY}" "${EC2_USER}@${EC2_HOST}" "sudo mysql -N -e \"SELECT user, host FROM mysql.user WHERE user='atomo';\""

echo "[grant] GRANT on each workspace database..."
for DB in "${DATABASES[@]}"; do
  echo "  --- ${DB} ---"
  ssh -i "${KEY}" "${EC2_USER}@${EC2_HOST}" bash -s "${DB}" <<'REMOTE'
set -euo pipefail
DB="$1"
while IFS=$'\t' read -r u h; do
  [[ -z "${u:-}" ]] && continue
  sudo mysql -e "GRANT ALL PRIVILEGES ON \`${DB}\`.* TO '${u}'@'${h}';"
done < <(sudo mysql -N -e "SELECT user, host FROM mysql.user WHERE user='atomo';")
REMOTE
done
ssh -i "${KEY}" "${EC2_USER}@${EC2_HOST}" "sudo mysql -e 'FLUSH PRIVILEGES;'"
ssh -i "${KEY}" "${EC2_USER}@${EC2_HOST}" "sudo mysql -e \"SHOW DATABASES LIKE 'atomo_forge_%';\""

echo ""
echo "Next: npm run migrate:events"
echo "Databases: ${DATABASES[*]}"
