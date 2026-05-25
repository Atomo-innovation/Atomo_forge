#!/usr/bin/env bash
# One command to run the app on the board with the correct browser URL (no https:// mistakes).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=scripts/forge-board-env.sh
source "$ROOT/scripts/forge-board-env.sh"

LAN_IP="$(node "$ROOT/scripts/forge-network.cjs" 2>/dev/null || ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)"
if [[ -z "$LAN_IP" ]]; then
  echo "[board] Could not detect LAN IP" >&2
  exit 1
fi

if ! getent hosts electron.local >/dev/null 2>&1; then
  echo "[board] electron.local does not resolve — fixing /etc/hosts (sudo)…"
  if sudo bash "$ROOT/scripts/board-fix-hosts.sh"; then
    echo "[board] electron.local is ready."
  else
    echo "[board] Could not fix hosts. Run manually: npm run board:fix-hosts" >&2
    echo "[board] Until then use: http://${LAN_IP}/" >&2
  fi
fi

if ! ss -tln 2>/dev/null | grep -qE ':80\b'; then
  echo "[board] Tip: run once → npm run board:setup   (installs Caddy on :80)"
fi

if [[ ! -f "$ROOT/devcert/cert.pem" ]]; then
  echo "[board] Generating devcert…"
  bash "$ROOT/scripts/generate-board-devcert.sh"
fi

if ! grep -q 'tls /etc/caddy/devcert' /etc/caddy/Caddyfile 2>/dev/null; then
  echo "[board] Tip: run once → npm run board:caddy-sync   (fixes https:// SSL errors)"
fi

export FORGE_LAN_IP="$LAN_IP"
export VITE_LAN_HTTP_URL="http://${LAN_IP}"
export FORGE_DEV_OPEN_URL="http://electron.local/dashboard"
export FORGE_OPEN_NO_PORT=1

echo ""
echo "══════════════════════════════════════════════════════════"
echo " Board dev — keep this terminal open"
echo "══════════════════════════════════════════════════════════"
echo "  Open in the browser ON THIS DEVICE (dashboard, no /login):"
echo "    http://electron.local/dashboard"
echo "    http://electron.local/"
echo "    http://${LAN_IP}/dashboard"
echo "  Direct Vite (if Caddy fails):"
echo "    http://${LAN_IP}:8443/"
echo "  Use http:// not https:// until: npm run board:caddy-sync"
echo "══════════════════════════════════════════════════════════"
echo ""

exec bash "$ROOT/scripts/npm-dev.sh" --no-tunnel "$@"
