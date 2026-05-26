#!/usr/bin/env bash
# Quick checks when the browser shows HTTP 502 on electron.local (run on the board).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() { printf 'FAIL: %s\n' "$*" >&2; }
ok() { printf 'OK:   %s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*"; }

echo "=== electron.local diagnostics ==="

if [[ -f "$ROOT/.forge-board" ]]; then
  ok "Board mode (.forge-board)"
else
  ok "Laptop dev — use npm run dev; board commands (board:*) are for the edge device only"
fi

if grep -qE '(^|[[:space:]])electron\.local([[:space:]]|$)' /etc/hosts 2>/dev/null; then
  warn "/etc/hosts maps electron.local → 127.0.0.1 (breaks LAN mDNS)"
  warn "Fix: npm run board:fix-hosts"
fi

if ss -tln 2>/dev/null | grep -qE ':8443\b'; then
  ok "Vite listening on :8443 (npm run board:dev must stay running)"
else
  fail "Nothing on :8443 — start: npm run board:dev"
fi

if ss -tln 2>/dev/null | grep -qE ':80\b'; then
  ok "Caddy listening on :80"
else
  fail "Caddy not on :80 — run: npm run board:setup"
fi

if ss -tln 2>/dev/null | grep -qE ':443\b'; then
  ok "Caddy listening on :443"
else
  warn "Caddy not on :443 — use http://electron.local"
fi

LAN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || echo 127.0.0.1)"

RESOLVED="$(getent ahostsv4 electron.local 2>/dev/null | awk '{print $1; exit}' || true)"
if [[ -n "$RESOLVED" && "$RESOLVED" != "$LAN_IP" && "$RESOLVED" != "127.0.0.1" ]]; then
  warn "electron.local resolves to $RESOLVED (expected $LAN_IP) — run: npm run board:fix-hosts"
fi
if grep -qE '(^|[[:space:]])127\.0\.0\.1[[:space:]]+electron\.local' /etc/hosts 2>/dev/null; then
  warn "Remove 127.0.0.1 electron.local from /etc/hosts — run: npm run board:fix-hosts"
fi

echo ""
echo "--- HTTP status ---"
for url in \
  "http://127.0.0.1/" \
  "http://electron.local/" \
  "https://127.0.0.1:8443/" \
  "https://electron.local/" \
  "http://${LAN_IP}/"
do
  code="$(curl -k -sS -o /dev/null -w '%{http_code}' --connect-timeout 3 "$url" 2>/dev/null || echo "err")"
  printf '%-40s → %s\n' "$url" "$code"
done

echo ""
echo "--- redirect (http://electron.local) ---"
curl -sSI --connect-timeout 3 http://electron.local/ 2>/dev/null | head -6 || true

echo ""
if [[ -f "$ROOT/devcert/cert.pem" ]]; then
  echo "--- devcert SAN ---"
  openssl x509 -in "$ROOT/devcert/cert.pem" -noout -ext subjectAltName 2>/dev/null || true
fi

HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 3 http://electron.local/ 2>/dev/null || echo err)"
HTTPS_CODE="$(curl -k -sS -o /dev/null -w '%{http_code}' --connect-timeout 3 https://electron.local/ 2>/dev/null || echo err)"
echo ""
if [[ "$HTTP_CODE" == "200" ]] && [[ "$HTTPS_CODE" != "200" ]] && [[ "$HTTPS_CODE" != "301" ]] && [[ "$HTTPS_CODE" != "308" ]]; then
  warn "http works but https fails ($HTTPS_CODE) — run: npm run board:caddy-sync"
  warn "Browser: type http://electron.local explicitly"
fi
if grep -qE 'reverse_proxy[[:space:]]+https://127\.0\.0\.1:8443' /etc/caddy/Caddyfile 2>/dev/null; then
  fail "Caddyfile proxies HTTPS→:8443 but Vite is HTTP — run: npm run board:caddy-sync"
fi
echo "502 = Vite not ready or stale /etc/caddy/Caddyfile (npm run board:caddy-sync)."
echo "ERR_SSL_PROTOCOL_ERROR = browser used https:// but Caddy HTTPS was misconfigured."
if ! getent hosts electron.local >/dev/null 2>&1; then
  fail "electron.local does not resolve — run: npm run board:fix-hosts"
else
  ok "electron.local resolves: $(getent hosts electron.local | awk '{print $1, $2}')"
fi
echo "Open: http://electron.local after VITE ready."
if [[ -f "$ROOT/.forge-board" ]]; then
  echo "Fix: npm run board:fix-hosts && npm run board:caddy-sync && npm run board:go"
else
  echo "Fix: npm run caddy:sync  (or skip Caddy: http://electron.local:8443/dashboard)"
fi
