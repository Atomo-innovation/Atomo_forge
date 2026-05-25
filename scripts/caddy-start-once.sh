#!/usr/bin/env bash
# One-time (or when :443 is down): enables Caddy so https://electron.local works (no :8443).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Run: npm run caddy:start  (uses sudo)" >&2; exit 1; }

bash "$ROOT/scripts/install-caddy-board.sh"
mkdir -p /etc/caddy

cp "$ROOT/Caddyfile" /etc/caddy/Caddyfile
if command -v caddy >/dev/null 2>&1; then
  caddy validate --config /etc/caddy/Caddyfile
fi
systemctl enable caddy
systemctl restart caddy
sleep 1
if ss -tln | grep -qE ':443\b'; then
  echo "[caddy] OK — https://electron.local is ready (npm run dev must still run for the app)"
else
  echo "[caddy] Failed to bind :443 — check: journalctl -u caddy -n 30" >&2
  exit 1
fi
