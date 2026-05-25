#!/usr/bin/env bash
# After git pull on the board: sync Caddyfile and reload (needs sudo).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CADDYFILE="$ROOT/Caddyfile.board"
if [[ ! -f "$CADDYFILE" ]]; then
  CADDYFILE="$ROOT/Caddyfile"
fi

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run: npm run board:caddy-sync   (uses sudo)" >&2
  exit 1
fi

if [[ ! -f "$CADDYFILE" ]]; then
  echo "Missing $CADDYFILE" >&2
  exit 1
fi

mkdir -p /etc/caddy/devcert
if [[ -f "$ROOT/devcert/cert.pem" && -f "$ROOT/devcert/key.pem" ]]; then
  cp "$ROOT/devcert/cert.pem" "$ROOT/devcert/key.pem" /etc/caddy/devcert/
  chmod 600 /etc/caddy/devcert/key.pem 2>/dev/null || true
else
  echo "[board] WARN: missing $ROOT/devcert — run: npm run board:devcert" >&2
fi
cp "$CADDYFILE" /etc/caddy/Caddyfile
if command -v caddy >/dev/null 2>&1; then
  caddy validate --config /etc/caddy/Caddyfile
fi
systemctl enable caddy 2>/dev/null || true
systemctl reload caddy 2>/dev/null || systemctl restart caddy
sleep 1
ss -tln | grep -qE ':80\b' && echo "[board] Caddy :80 OK" || echo "[board] WARN: :80 not listening" >&2
ss -tln | grep -qE ':443\b' && echo "[board] Caddy :443 OK" || echo "[board] WARN: :443 not listening" >&2
echo "[board] Caddyfile synced."
