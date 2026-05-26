#!/usr/bin/env bash
# Prepare http://electron.local for npm run dev (hosts + default open URL).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export VITE_DEV_HOST="${VITE_DEV_HOST:-electron.local}"
DEV_PORT="${VITE_DEV_PORT:-8443}"

is_board() {
  [[ "${FORGE_BOARD:-}" == "1" ]] || [[ -f "$ROOT/.forge-board" ]]
}

port80_listening() {
  ss -tln 2>/dev/null | grep -qE ':80\b'
}

if is_board; then
  LAN="$(node "$ROOT/scripts/forge-network.cjs" 2>/dev/null || true)"
  if getent ahostsv4 electron.local 2>/dev/null | awk '{print $1}' | grep -qE '^172\.(1[678]|2[0-9])\.'; then
    printf '[forge] WARN: electron.local → Docker IP. Run: npm run board:fix-hosts\n' >&2
    if [[ -n "$LAN" ]]; then
      export FORGE_DEV_OPEN_URL="${FORGE_DEV_OPEN_URL:-http://${LAN}/dashboard}"
    fi
  else
    export FORGE_DEV_OPEN_URL="${FORGE_DEV_OPEN_URL:-http://electron.local/dashboard}"
  fi
  export FORGE_OPEN_NO_PORT=1
else
  # Laptop: /etc/hosts → 127.0.0.1; use :80 only when Caddy is up, else Vite :8443 directly.
  if ! getent hosts electron.local >/dev/null 2>&1; then
    printf '[forge] Adding 127.0.0.1 electron.local to /etc/hosts (needs sudo once)...\n' >&2
    if [[ "${FORGE_CADDY_NO_SUDO:-}" != "1" ]] && sudo -n sh -c 'grep -q electron.local /etc/hosts 2>/dev/null || echo "127.0.0.1 electron.local" >> /etc/hosts' 2>/dev/null; then
      printf '[forge] /etc/hosts updated.\n'
    else
      printf '[forge] Run once: echo "127.0.0.1 electron.local" | sudo tee -a /etc/hosts\n' >&2
    fi
  fi
  if port80_listening; then
    export FORGE_DEV_OPEN_URL="${FORGE_DEV_OPEN_URL:-http://electron.local/dashboard}"
    export FORGE_OPEN_NO_PORT=1
  else
    export FORGE_DEV_OPEN_URL="${FORGE_DEV_OPEN_URL:-http://electron.local:${DEV_PORT}/dashboard}"
    export FORGE_OPEN_NO_PORT=0
    printf '[forge] Laptop: no Caddy on :80 — using Vite directly. Optional: npm run caddy:start\n' >&2
  fi
fi

printf '\n[forge] App URL: %s\n' "${FORGE_DEV_OPEN_URL}"
printf '[forge] Use http:// — not https:// — to avoid SSL errors.\n\n'
