#!/usr/bin/env bash
# Start Caddy on :443 so https://electron.local works (no :8443 in the URL).
# Called once at the beginning of `npm run dev` (interactive sudo when needed).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CADDYFILE="${ROOT}/Caddyfile"

log() { printf '[forge] %s\n' "$*"; }

port443_listening() {
  ss -tln 2>/dev/null | grep -qE ':443\b'
}

if [[ "${FORGE_SKIP_CADDY:-}" == "1" ]]; then
  log 'FORGE_SKIP_CADDY=1 — use https://electron.local:8443'
  exit 0
fi

if ! grep -qE '(^|[[:space:]])electron\.local([[:space:]]|$)' /etc/hosts 2>/dev/null; then
  log 'Missing /etc/hosts entry. Run:'
  log '  sudo sh -c '\''echo "127.0.0.1 electron.local" >> /etc/hosts'\'''
fi

if port443_listening; then
  log 'HTTPS proxy ready → https://electron.local'
  exit 0
fi

if ! command -v caddy >/dev/null 2>&1; then
  log 'Install Caddy: sudo apt-get install -y caddy'
  log 'Then run: npm run caddy:start'
  exit 0
fi

if [[ ! -f "$CADDYFILE" ]]; then
  log "Missing ${CADDYFILE}"
  exit 0
fi

if [[ -t 0 ]] && [[ -t 1 ]]; then
  log 'Port 443 is required for https://electron.local (no port in URL).'
  log 'Enter your sudo password once to start Caddy…'
  if sudo -v \
    && sudo cp "$CADDYFILE" /etc/caddy/Caddyfile \
    && sudo systemctl enable caddy 2>/dev/null \
    && sudo systemctl restart caddy; then
    sleep 1
    if port443_listening; then
      log 'OK → open https://electron.local'
      exit 0
    fi
    log 'Caddy started but :443 is not listening. Check: journalctl -u caddy -n 30'
    exit 0
  fi
  log 'sudo failed — open https://electron.local:8443 or run: npm run caddy:start'
  exit 0
fi

log 'No TTY for sudo. Run once: npm run caddy:start'
log 'Or open: https://electron.local:8443'
exit 0
