#!/usr/bin/env bash
# Ensures https://electron.local (:443) when possible. Vite always serves :8443.
# Skip: FORGE_SKIP_CADDY=1  |  No sudo attempts: FORGE_CADDY_NO_SUDO=1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CADDYFILE="${ROOT}/Caddyfile"
DEV_URL="${FORGE_DEV_URL:-https://electron.local:8443}"

log() { printf '[caddy] %s\n' "$*"; }

keep_alive() {
  exec tail -f /dev/null
}

port443_listening() {
  ss -tln 2>/dev/null | grep -qE ':443\b'
}

warn_hosts() {
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
  log 'For https://electron.local (no port): restart npm run dev and enter sudo when prompted,'
  log 'or run once: npm run caddy:start'
  log '────────────────────────────────────────────────────────'
}

if [[ "${FORGE_SKIP_CADDY:-}" == "1" ]]; then
  log 'Skipped (FORGE_SKIP_CADDY=1).'
  print_use_8443
  keep_alive
fi

warn_hosts

if port443_listening; then
  log 'Port 443 ready → https://electron.local'
  log "Vite: ${DEV_URL}"
  keep_alive
fi

if ! command -v caddy >/dev/null 2>&1; then
  log 'Caddy not installed (sudo apt-get install -y caddy).'
  print_use_8443
  keep_alive
fi

if [[ -f "$CADDYFILE" ]] && [[ "${FORGE_SYNC_CADDYFILE:-1}" == "1" ]]; then
  if ! run_sudo_n cp "$CADDYFILE" /etc/caddy/Caddyfile; then
    log 'Could not sync Caddyfile (sudo -n). Run: sudo cp Caddyfile /etc/caddy/Caddyfile'
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
