#!/usr/bin/env bash
# One-time on the edge board: mDNS + devcert + Caddy → http(s)://electron.local (no :8443 in URL).
# Run: npm run board:setup
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="${SUDO_USER:-${USER:-root}}"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run: npm run board:setup   (uses sudo)" >&2
  exit 1
fi

echo "[board] mDNS (electron.local → this machine's LAN IP)…"
bash "$ROOT/scripts/setup-mdns-electron-local.sh"

echo "[board] HTTPS dev certificate for Vite (:8443)…"
if [[ "$RUN_USER" != "root" ]] && id "$RUN_USER" &>/dev/null; then
  sudo -u "$RUN_USER" bash "$ROOT/scripts/generate-board-devcert.sh"
else
  bash "$ROOT/scripts/generate-board-devcert.sh"
fi

echo "[board] Caddy (:80 http + :443 https → Vite :8443)…"
bash "$ROOT/scripts/install-caddy-board.sh"
mkdir -p /etc/caddy
BOARD_CADDY="$ROOT/Caddyfile.board"
if [[ ! -f "$BOARD_CADDY" ]]; then
  echo "[board] Missing $BOARD_CADDY" >&2
  exit 1
fi
mkdir -p /etc/caddy/devcert
cp "$ROOT/devcert/cert.pem" "$ROOT/devcert/key.pem" /etc/caddy/devcert/
chmod 600 /etc/caddy/devcert/key.pem 2>/dev/null || true
cp "$BOARD_CADDY" /etc/caddy/Caddyfile
if command -v caddy >/dev/null 2>&1; then
  caddy validate --config /etc/caddy/Caddyfile
fi
systemctl enable caddy
systemctl restart caddy
sleep 1

if ! ss -tln 2>/dev/null | grep -qE ':80\b'; then
  echo "[board] WARN: port 80 not listening — http://electron.local may fail" >&2
  echo "[board] Check: journalctl -u caddy -n 40" >&2
fi
if ! ss -tln 2>/dev/null | grep -qE ':443\b'; then
  echo "[board] WARN: port 443 not listening — https://electron.local may fail" >&2
  echo "[board] Check: journalctl -u caddy -n 40" >&2
fi

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 8443/tcp
fi

MARKER="$ROOT/.forge-board"
printf 'setup=%s\n' "$(date -Iseconds 2>/dev/null || date)" >"$MARKER"
if [[ "$RUN_USER" != "root" ]] && id "$RUN_USER" &>/dev/null; then
  chown "$RUN_USER":"$RUN_USER" "$MARKER" 2>/dev/null || true
fi

LAN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)"
echo ""
echo "══════════════════════════════════════════════════════════"
echo " Board setup done."
echo "══════════════════════════════════════════════════════════"
echo "  1) npm install          (if you have not already)"
echo "  2) npm run dev          (or: npm run board:dev — keep terminal open)"
echo "  3) Browser on this board:"
echo "       http://electron.local"
echo "     Other devices on Wi‑Fi:"
echo "       http://electron.local  or  http://${LAN_IP:-<LAN-IP>}"
echo ""
echo "  Fallback (direct Vite):  https://${LAN_IP:-127.0.0.1}:8443/"
echo "  After git pull:          npm run board:caddy-sync"
echo "  Troubleshooting:         npm run board:check"
echo ""
  echo "  Then: npm run board:fix-hosts  (pins electron.local to LAN IP on this device)"
  echo "  Do NOT use 127.0.0.1 electron.local in /etc/hosts."
echo "══════════════════════════════════════════════════════════"

if [[ "$RUN_USER" != "root" ]] && id "$RUN_USER" &>/dev/null; then
  sudo -u "$RUN_USER" bash "$ROOT/scripts/check-electron-local.sh" 2>/dev/null || true
fi
