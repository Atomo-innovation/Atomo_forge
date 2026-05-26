#!/usr/bin/env bash
# Sync repo Caddyfile → /etc/caddy and restart (laptop or board). Run once after git pull.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Run: npm run caddy:sync  (uses sudo)" >&2; exit 1; }

is_board() {
  [[ "${FORGE_BOARD:-}" == "1" ]] || [[ -f "$ROOT/.forge-board" ]]
}

if is_board && [[ -f "$ROOT/Caddyfile.board" ]]; then
  CADDYFILE="$ROOT/Caddyfile.board"
else
  CADDYFILE="$ROOT/Caddyfile"
fi

if [[ ! -f "$CADDYFILE" ]]; then
  echo "Missing $CADDYFILE" >&2
  exit 1
fi

mkdir -p /etc/caddy/devcert
if [[ -f "$ROOT/devcert/cert.pem" && -f "$ROOT/devcert/key.pem" ]]; then
  cp "$ROOT/devcert/cert.pem" "$ROOT/devcert/key.pem" /etc/caddy/devcert/
  chmod 600 /etc/caddy/devcert/key.pem 2>/dev/null || true
fi

cp "$CADDYFILE" /etc/caddy/Caddyfile
if command -v caddy >/dev/null 2>&1; then
  caddy validate --config /etc/caddy/Caddyfile
fi
systemctl enable caddy 2>/dev/null || true
timeout 15 systemctl restart caddy || {
  echo "[caddy] restart failed — journalctl -u caddy -n 30" >&2
  exit 1
}
sleep 2

ss -tln | grep -qE ':80\b' && echo "[caddy] :80 OK" || echo "[caddy] WARN: :80 not listening" >&2
CODE="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 3 http://127.0.0.1/ 2>/dev/null || echo err)"
if [[ "$CODE" == "200" ]]; then
  echo "[caddy] http://127.0.0.1/ → $CODE"
  echo "[caddy] Open: http://electron.local/dashboard  (npm run dev must be running)"
else
  echo "[caddy] WARN: http://127.0.0.1/ → $CODE (start npm run dev first; Vite listens on :8443)" >&2
  echo "[caddy] Or skip Caddy: http://electron.local:8443/dashboard"
fi
