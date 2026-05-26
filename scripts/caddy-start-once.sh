#!/usr/bin/env bash
# One-time (or when :443 is down): enables Caddy so https://electron.local works (no :8443).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Run: npm run caddy:start  (uses sudo)" >&2; exit 1; }

bash "$ROOT/scripts/install-caddy-board.sh"
mkdir -p /etc/caddy/devcert
if [[ -f "$ROOT/devcert/cert.pem" && -f "$ROOT/devcert/key.pem" ]]; then
  cp "$ROOT/devcert/cert.pem" "$ROOT/devcert/key.pem" /etc/caddy/devcert/
fi

CADDY_SRC="$ROOT/Caddyfile"
if [[ -f "$ROOT/.forge-board" ]] && [[ -f "$ROOT/Caddyfile.board" ]]; then
  CADDY_SRC="$ROOT/Caddyfile.board"
fi
cp "$CADDY_SRC" /etc/caddy/Caddyfile
if command -v caddy >/dev/null 2>&1; then
  caddy validate --config /etc/caddy/Caddyfile
fi
systemctl enable caddy
timeout 15 systemctl restart caddy
sleep 2
if ss -tln | grep -qE ':80\b'; then
  echo "[caddy] OK — http://electron.local (npm run dev must still run for the app)"
  echo "[caddy] If 502: npm run caddy:sync  (with dev running)"
else
  echo "[caddy] Failed to bind :80 — check: journalctl -u caddy -n 30" >&2
  exit 1
fi
