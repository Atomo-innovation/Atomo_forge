#!/usr/bin/env bash
# Single-command dev: optional Caddy :443, then all Forge services via concurrently.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if bash "$ROOT/scripts/detect-forge-board.sh"; then
  # shellcheck source=scripts/forge-board-env.sh
  source "$ROOT/scripts/forge-board-env.sh"
  LAN_HINT="${FORGE_LAN_IP:-}"
  if [[ -z "$LAN_HINT" ]]; then
    LAN_HINT="$(node "$ROOT/scripts/forge-network.cjs" 2>/dev/null || true)"
  fi
  printf '[forge] Board — open http://%s/ in the browser (not https://). Keep this terminal open.\n' "${LAN_HINT:-<LAN-IP>}"
  if [[ -n "$LAN_HINT" ]] && getent ahostsv4 electron.local 2>/dev/null | awk '{print $1}' | grep -qE '^172\.(1[678]|2[0-9])\.'; then
    printf '[forge] WARN: electron.local resolves to Docker, not Wi‑Fi. Fix: npm run board:fix-hosts\n'
    printf '[forge] Or use: http://%s/\n' "$LAN_HINT"
  fi
fi

NO_TUNNEL=0
for arg in "$@"; do
  case "$arg" in
    --no-tunnel) NO_TUNNEL=1 ;;
  esac
done

# One terminal: tunnel (if needed) + 4 event DB migrations, then concurrently starts everything.
if [[ "$NO_TUNNEL" -eq 0 ]]; then
  bash "$ROOT/scripts/ensure-events-mysql.sh" || true
fi

bash scripts/ensure-caddy-443.sh
bash scripts/ensure-mdns-electron-local.sh || true
export FORGE_LAN_IP="$(node scripts/forge-network.cjs 2>/dev/null || ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)"
if [[ -n "${FORGE_LAN_IP:-}" ]]; then
  export VITE_LAN_HTTP_URL="http://${FORGE_LAN_IP}"
  export FORGE_LAN_HTTP_URL="$VITE_LAN_HTTP_URL"
fi
bash scripts/print-lan-access.sh

if [[ "${FORGE_BOARD:-}" == "1" ]]; then
  if ss -tln 2>/dev/null | grep -qE ':80\b'; then
    export FORGE_OPEN_NO_PORT=1
    export FORGE_DEV_OPEN_URL="${FORGE_DEV_OPEN_URL:-http://electron.local/}"
  elif [[ -n "${FORGE_LAN_IP:-}" ]]; then
    export FORGE_DEV_OPEN_URL="${FORGE_DEV_OPEN_URL:-https://${FORGE_LAN_IP}:8443/}"
  fi
elif ss -tln 2>/dev/null | grep -qE ':443\b'; then
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
