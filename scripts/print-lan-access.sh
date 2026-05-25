#!/usr/bin/env bash
# Print URLs for phones/tablets/other PCs on the same Wi‑Fi.
set -euo pipefail

log() { printf '[forge] %s\n' "$*"; }

lan_ip() {
  local from_node
  from_node="$(node "$(cd "$(dirname "$0")/.." && pwd)/scripts/forge-network.cjs" 2>/dev/null || true)"
  if [[ -n "$from_node" ]]; then
    printf '%s' "$from_node"
    return
  fi
  ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true
}

LAN_IP="${FORGE_LAN_IP:-$(lan_ip)}"
export FORGE_LAN_IP="$LAN_IP"
if [[ -z "$LAN_IP" ]]; then
  log 'Could not detect LAN IP — other devices: use Settings → Wi‑Fi → this PC’s IP'
  exit 0
fi

log '────────────────── LAN (other devices) ──────────────────'
log 'Same Wi‑Fi only. On phone/tablet/other PC, type in the browser:'
if [[ "${FORGE_MDNS_ACTIVE:-0}" == "1" ]] || (command -v systemctl >/dev/null 2>&1 && systemctl is-active avahi-daemon &>/dev/null 2>&1); then
  log '  http://electron.local   ← preferred (mDNS)'
  log "  http://${LAN_IP}          ← fallback if .local does not resolve"
else
  log '  http://electron.local   ← run once: npm run lan:setup'
  log "  http://${LAN_IP}          ← works without mDNS"
fi
log 'Use http:// not https:// on other devices (unless you install the Caddy CA).'
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$ROOT/.forge-board" ]] || [[ "${FORGE_BOARD:-}" == "1" ]]; then
  log 'This board: http://electron.local  (setup: npm run board:setup, dev: npm run board:dev)'
else
  log 'This PC: https://electron.local or https://electron.local:8443 (may use /etc/hosts)'
fi
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
  log 'Firewall active — if LAN fails: sudo ufw allow 80,443/tcp'
fi
log '────────────────────────────────────────────────────────'
