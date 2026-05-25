#!/usr/bin/env bash
# Board / edge device mode (auto: hostname electron, or npm run board:setup).
export FORGE_BOARD=1
export FORGE_CADDY_NO_SUDO=1
export FORGE_SYNC_CADDYFILE=1
export FORGE_VITE_PLAIN_HTTP=1
export VITE_DEV_HOST="${VITE_DEV_HOST:-electron.local}"
# Board: local login (board@local). Detection events use atomo_forge only — not MeshCentral.
export VITE_FORGE_BOARD_LOCAL_AUTH=1
export VITE_FORGE_BOARD_LOCAL_USER="${VITE_FORGE_BOARD_LOCAL_USER:-board@local}"
# zenity folder dialog when auth-server is started from npm run dev
export DISPLAY="${DISPLAY:-:0}"

_board_lan_ip() {
  node "$(dirname "${BASH_SOURCE[0]}")/forge-network.cjs" 2>/dev/null \
    || ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' \
    || true
}
_BOARD_LAN="$(_board_lan_ip)"
if [[ -n "$_BOARD_LAN" ]]; then
  export FORGE_LAN_IP="${FORGE_LAN_IP:-$_BOARD_LAN}"
  export VITE_LAN_HTTP_URL="${VITE_LAN_HTTP_URL:-http://${_BOARD_LAN}}"
  # Prefer LAN IP in the browser — electron.local often resolves to docker0 (172.18.x) on the board.
  export FORGE_DEV_OPEN_URL="${FORGE_DEV_OPEN_URL:-http://${_BOARD_LAN}/}"
  export FORGE_OPEN_NO_PORT="${FORGE_OPEN_NO_PORT:-1}"
fi
unset _BOARD_LAN _board_lan_ip

forge_is_board() {
  [[ "${FORGE_BOARD:-}" == "1" ]] || [[ -f "${1:-.}/.forge-board" ]]
}
