#!/usr/bin/env bash
# Bootstrap MySQL tunnel (if needed) and migrate 4 workspace event DBs before auth-server starts.
# Called from npm-dev.sh — not run manually in a second terminal.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "${ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ROOT}/.env"
  set +a
fi

PORT="${MYSQL_EVENTS_PORT:-${MYSQL_PORT:-3307}}"
KEY="${FORGE_EC2_SSH_KEY:-$HOME/Downloads/atomo_web.pem}"
KEY="${KEY/#\~/$HOME}"
EC2_HOST="${FORGE_EC2_HOST:-65.2.142.160}"
EC2_USER="${FORGE_EC2_USER:-ubuntu}"

port_open() {
  ss -ltn 2>/dev/null | grep -qE "(^|:)${PORT}\$" || return 1
}

if port_open; then
  echo "[forge:db] MySQL tunnel port ${PORT} already open."
else
  echo "[forge:db] Opening SSH tunnel → EC2 MySQL on 127.0.0.1:${PORT} ..."
  if [[ ! -f "${KEY}" ]]; then
    echo "[forge:db] WARN: SSH key missing (${KEY}) — event DBs unavailable. Use board mode or set FORGE_EC2_SSH_KEY." >&2
    exit 0
  fi
  if ! ssh -f -N \
    -o ServerAliveInterval=30 \
    -o ExitOnForwardFailure=yes \
    -o StrictHostKeyChecking=accept-new \
    -L "${PORT}:127.0.0.1:3306" \
    -i "${KEY}" \
    "${EC2_USER}@${EC2_HOST}" 2>/dev/null; then
    echo "[forge:db] WARN: could not start tunnel — detections use browser storage only." >&2
    exit 0
  fi
  for _ in $(seq 1 25); do
    port_open && break
    sleep 1
  done
  if ! port_open; then
    echo "[forge:db] WARN: tunnel did not open port ${PORT} in time." >&2
    exit 0
  fi
  echo "[forge:db] Tunnel ready."
fi

echo "[forge:db] Migrating atomo_forge_person / _fire / _face / _safety ..."
if (cd "${ROOT}" && node -e "require('./scripts/db-migrate.cjs').runEventsMigrations().then(r=>process.exit(r.ok?0:1))"); then
  echo "[forge:db] Event databases ready."
else
  echo "[forge:db] WARN: migrations failed — first time on EC2? Run once: npm run grant:events-db" >&2
fi
