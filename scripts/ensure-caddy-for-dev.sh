#!/usr/bin/env bash
# Ensures https://electron.local (:443) when possible. Vite always serves :8443.
# Skip: FORGE_SKIP_CADDY=1  |  No sudo attempts: FORGE_CADDY_NO_SUDO=1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CADDYFILE="${ROOT}/Caddyfile"
DEV_URL="${FORGE_DEV_URL:-http://electron.local:8443}"

log() { printf '[caddy] %s\n' "$*"; }

keep_alive() {
  exec tail -f /dev/null
}

port443_listening() {
  ss -tln 2>/dev/null | grep -qE ':443\b'
}

port80_listening() {
  ss -tln 2>/dev/null | grep -qE ':80\b'
}

is_board() {
  [[ "${FORGE_BOARD:-}" == "1" ]] || [[ -f "$ROOT/.forge-board" ]]
}

warn_hosts() {
  if is_board; then
    if grep -qE '(^|[[:space:]])electron\.local([[:space:]]|$)' /etc/hosts 2>/dev/null; then
      log 'WARN: /etc/hosts maps electron.local → 127.0.0.1 (breaks LAN). Run: npm run board:fix-hosts'
    fi
    return 0
  fi
  if ! grep -qE '(^|[[:space:]])electron\.local([[:space:]]|$)' /etc/hosts 2>/dev/null; then
    log 'Add: sudo sh -c '\''echo "127.0.0.1 electron.local" >> /etc/hosts'\'''
  fi
}

# Non-interactive sudo only — avoids hanging `npm run dev` when no TTY/password.
run_sudo_n() {
  [[ "${FORGE_CADDY_NO_SUDO:-}" == "1" ]] && return 1
  sudo -n "$@" 2>/dev/null
}

print_use_8443() {
  log '────────────────────────────────────────────────────────'
  log "Fallback URL: ${DEV_URL}"
  if is_board; then
    log 'Board: run npm run board:setup once, then npm run board:dev'
  else
    log 'For https://electron.local (no port): restart npm run dev and enter sudo when prompted,'
    log 'or run once: npm run caddy:start'
  fi
  log '────────────────────────────────────────────────────────'
}

if [[ "${FORGE_SKIP_CADDY:-}" == "1" ]]; then
  log 'Skipped (FORGE_SKIP_CADDY=1).'
  print_use_8443
  keep_alive
fi

warn_hosts

caddyfile_stale_502() {
  [[ -f /etc/caddy/Caddyfile ]] || return 1
  grep -qE 'reverse_proxy[[:space:]]+https://127\.0\.0\.1:8443' /etc/caddy/Caddyfile 2>/dev/null
}

sync_caddyfile() {
  local src="$1"
  [[ -f "$src" ]] || return 1
  if run_sudo_n cp "$src" /etc/caddy/Caddyfile && run_sudo_n systemctl restart caddy; then
    return 0
  fi
  return 1
}

if is_board; then
  BOARD_CADDY="$ROOT/Caddyfile.board"
  SYNC_FROM="$CADDYFILE"
  [[ -f "$BOARD_CADDY" ]] && SYNC_FROM="$BOARD_CADDY"
  if [[ -f "$SYNC_FROM" ]] && [[ "${FORGE_SYNC_CADDYFILE:-1}" == "1" ]]; then
    if ! sync_caddyfile "$SYNC_FROM"; then
      if caddyfile_stale_502; then
        log 'ERROR: /etc/caddy/Caddyfile proxies HTTPS→:8443 but Vite is HTTP → browser shows 502'
        log 'Fix (once): npm run board:caddy-sync'
      else
        log 'WARN: could not sync Caddyfile (passwordless sudo failed). Run: npm run board:caddy-sync'
      fi
    fi
  fi
  if port80_listening || port443_listening; then
    if caddyfile_stale_502; then
      log 'WARN: Caddy is up but Caddyfile is stale — npm run board:caddy-sync'
    else
      log 'Board: Caddy ready → http://electron.local'
    fi
    keep_alive
  fi
  log 'Board: Caddy not on :80/:443 — run: npm run board:setup'
  print_use_8443
  keep_alive
fi

if port80_listening; then
  log 'Port 80 ready → http://electron.local'
  keep_alive
fi

if port443_listening; then
  log 'Port 443 ready (optional https://electron.local)'
  log "Prefer: http://electron.local  |  Vite: ${DEV_URL}"
  keep_alive
fi

if ! command -v caddy >/dev/null 2>&1; then
  log 'Caddy not installed (sudo apt-get install -y caddy).'
  print_use_8443
  keep_alive
fi

if [[ -f "$CADDYFILE" ]] && [[ "${FORGE_SYNC_CADDYFILE:-1}" == "1" ]]; then
  if ! sync_caddyfile "$CADDYFILE"; then
    if caddyfile_stale_502; then
      log 'ERROR: stale Caddyfile (HTTPS→:8443) causes 502 — run: npm run caddy:sync'
    else
      log 'Could not sync Caddyfile (sudo -n). Run: npm run caddy:sync'
    fi
  fi
fi

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files caddy.service &>/dev/null; then
  if run_sudo_n systemctl start caddy; then
    sleep 1
    if port443_listening; then
      log 'caddy.service started → https://electron.local'
      keep_alive
    fi
  else
    log 'Could not start caddy.service without password (sudo -n failed).'
  fi
fi

print_use_8443
keep_alive
