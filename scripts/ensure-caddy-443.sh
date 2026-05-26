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

port80_listening() {
  ss -tln 2>/dev/null | grep -qE ':80\b'
}

is_board() {
  [[ "${FORGE_BOARD:-}" == "1" ]] || [[ -f "$ROOT/.forge-board" ]]
}

sync_caddyfile_n() {
  local from="$CADDYFILE"
  if is_board && [[ -f "$ROOT/Caddyfile.board" ]]; then
    from="$ROOT/Caddyfile.board"
  fi
  [[ -f "$from" ]] || return 1
  sudo -n cp "$from" /etc/caddy/Caddyfile 2>/dev/null \
    && sudo -n systemctl reload caddy 2>/dev/null
}

if [[ "${FORGE_SKIP_CADDY:-}" == "1" ]]; then
  log 'FORGE_SKIP_CADDY=1 — use https://electron.local:8443'
  exit 0
fi

if is_board; then
  if port80_listening || port443_listening; then
    sync_caddyfile_n || true
    log 'Board proxy ready → http://electron.local (https://electron.local optional)'
    exit 0
  fi
  log 'Board: Caddy not listening. Run once: npm run board:setup'
  exit 0
fi

if ! grep -qE '(^|[[:space:]])electron\.local([[:space:]]|$)' /etc/hosts 2>/dev/null; then
  log 'Missing /etc/hosts entry. Run:'
  log '  sudo sh -c '\''echo "127.0.0.1 electron.local" >> /etc/hosts'\'''
fi

if port80_listening; then
  log 'HTTP proxy ready → http://electron.local  (use http:// not https://)'
  exit 0
fi

if port443_listening; then
  log 'HTTPS on :443 — prefer http://electron.local unless you need TLS'
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
  log 'Optional: Caddy on :80 for http://electron.local (no :8443 in URL).'
  log 'Enter your sudo password once to start Caddy…'
  SYNC_FROM="$CADDYFILE"
  if is_board && [[ -f "$ROOT/Caddyfile.board" ]]; then
    SYNC_FROM="$ROOT/Caddyfile.board"
  fi
  if sudo -v \
    && sudo cp "$SYNC_FROM" /etc/caddy/Caddyfile \
    && sudo systemctl enable caddy 2>/dev/null \
    && timeout 15 sudo systemctl restart caddy; then
    sleep 2
    if port80_listening; then
      log 'OK → open http://electron.local/dashboard  (npm run dev must be running)'
      exit 0
    fi
    log 'Caddy started but :80 is not listening. Check: journalctl -u caddy -n 30'
    exit 0
  fi
  log 'sudo failed — open http://electron.local:8443/dashboard  (no Caddy needed)'
  exit 0
fi

log 'No TTY for sudo. Run once: npm run caddy:start'
log 'Or open: http://electron.local:8443/dashboard'
exit 0
