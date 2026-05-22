#!/usr/bin/env bash
# Single-command dev: optional Caddy :443, then all Forge services via concurrently.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NO_TUNNEL=0
for arg in "$@"; do
  case "$arg" in
    --no-tunnel) NO_TUNNEL=1 ;;
  esac
done

bash scripts/ensure-caddy-443.sh
export FORGE_LAN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)"
bash scripts/print-lan-access.sh

if ss -tln 2>/dev/null | grep -qE ':443\b'; then
  export FORGE_OPEN_NO_PORT=1
  export FORGE_DEV_OPEN_URL="https://electron.local/"
fi

CONCURRENTLY=(npx concurrently -k)

if [[ "$NO_TUNNEL" -eq 1 ]]; then
  exec "${CONCURRENTLY[@]}" -n api,twin,detect,mtx,caddy,web -c cyan,green,red,blue,white,magenta \
    "node auth-server.cjs" \
    "node scripts/start-pdeu-digital-twin.cjs" \
    "node scripts/start-combine-detector.cjs" \
    "node scripts/start-mediamtx.cjs" \
    "bash scripts/ensure-caddy-for-dev.sh" \
    "vite"
else
  exec "${CONCURRENTLY[@]}" -n tunnel,api,twin,detect,mtx,caddy,web -c yellow,cyan,green,red,blue,white,magenta \
    "bash scripts/mysql-tunnel-to-ec2.sh" \
    "node auth-server.cjs" \
    "node scripts/start-pdeu-digital-twin.cjs" \
    "node scripts/start-combine-detector.cjs" \
    "node scripts/start-mediamtx.cjs" \
    "bash scripts/ensure-caddy-for-dev.sh" \
    "vite"
fi
