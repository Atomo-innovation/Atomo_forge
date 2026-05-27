#!/usr/bin/env bash
# Single-command dev: optional Caddy :443, then all Forge services via concurrently.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Dev: Vite on :8443 is plain HTTP; Caddy on :80 proxies to it (HTTPS upstream → 502).
export FORGE_VITE_PLAIN_HTTP="${FORGE_VITE_PLAIN_HTTP:-1}"

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
else
  printf '[forge] Laptop — this PC: http://electron.local:8443/dashboard\n'
  printf '[forge] Share on Wi‑Fi (phones/other PCs): npm run lan:share  (http://electron.local, not https)\n'
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
bash "$ROOT/scripts/ensure-electron-local-dev.sh"

CONCURRENTLY=(npx concurrently -k)

FACE_STREAM_CMDS=()
FACE_STREAM_NAMES=""
FACE_STREAM_COLORS=""
if [[ -f "$ROOT/live_stream/server.js" ]] && [[ "${FORGE_SKIP_FACE_STREAM:-}" != "1" ]]; then
  export LIVE_STREAM_PORT="${LIVE_STREAM_PORT:-3010}"
  export FORGE_SKIP_MEDIAMTX="${FORGE_SKIP_MEDIAMTX:-1}"
  FACE_STREAM_CMDS=(
    "node scripts/start-live-stream.cjs"
    "node scripts/start-face-detector.cjs"
  )
  FACE_STREAM_NAMES=",face,facepy"
  FACE_STREAM_COLORS=",magenta,cyan"
  printf '[forge] Face stream → http://127.0.0.1:%s (Vite proxy /face-stream)\n' "$LIVE_STREAM_PORT"
fi

if [[ "$NO_TUNNEL" -eq 1 ]]; then
  exec "${CONCURRENTLY[@]}" -n "api,twin,detect,mtx,caddy,web${FACE_STREAM_NAMES}" -c "cyan,green,red,blue,white,magenta${FACE_STREAM_COLORS}" \
    "node auth-server.cjs" \
    "node scripts/start-pdeu-digital-twin.cjs" \
    "node scripts/start-combine-detector.cjs" \
    "node scripts/start-mediamtx.cjs" \
    "bash scripts/ensure-caddy-for-dev.sh" \
    "vite" \
    "${FACE_STREAM_CMDS[@]}"
else
  exec "${CONCURRENTLY[@]}" -n "tunnel,api,twin,detect,mtx,caddy,web${FACE_STREAM_NAMES}" -c "yellow,cyan,green,red,blue,white,magenta${FACE_STREAM_COLORS}" \
    "bash scripts/mysql-tunnel-to-ec2.sh" \
    "node auth-server.cjs" \
    "node scripts/start-pdeu-digital-twin.cjs" \
    "node scripts/start-combine-detector.cjs" \
    "node scripts/start-mediamtx.cjs" \
    "bash scripts/ensure-caddy-for-dev.sh" \
    "vite" \
    "${FACE_STREAM_CMDS[@]}"
fi
