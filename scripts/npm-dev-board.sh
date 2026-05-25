#!/usr/bin/env bash
# Dev stack tuned for the edge board (no SSH tunnel, http://electron.local in browser).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=scripts/forge-board-env.sh
source "$ROOT/scripts/forge-board-env.sh"

if [[ ! -f "$ROOT/.forge-board" ]]; then
  printf '[board] WARN: run once as root: npm run board:setup\n' >&2
fi

# Prefer plain HTTP via Caddy :80 (no browser cert warning on the board).
if ss -tln 2>/dev/null | grep -qE ':80\b'; then
  export FORGE_DEV_OPEN_URL="${FORGE_DEV_OPEN_URL:-http://electron.local/}"
  export FORGE_OPEN_NO_PORT=1
else
  export FORGE_DEV_OPEN_URL="${FORGE_DEV_OPEN_URL:-https://electron.local:8443/}"
fi

exec bash "$ROOT/scripts/npm-dev.sh" --no-tunnel "$@"
