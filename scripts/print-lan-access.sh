#!/usr/bin/env bash
# Print URLs for phones/tablets/other PCs on the same Wi‑Fi.
set -euo pipefail

log() { printf '[forge] %s\n' "$*"; }

lan_ip() {
  ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true
}

LAN_IP="${FORGE_LAN_IP:-$(lan_ip)}"
export FORGE_LAN_IP="$LAN_IP"
if [[ -z "$LAN_IP" ]]; then
  log 'Could not detect LAN IP — other devices: use Settings → Wi‑Fi → this PC’s IP'
  exit 0
fi

log '────────────────── LAN (other devices) ──────────────────'
log "Same Wi‑Fi only. On phone/tablet/other PC, open:"
log "  http://${LAN_IP}"
if command -v avahi-resolve &>/dev/null && systemctl is-active avahi-daemon &>/dev/null 2>&1; then
  log '  http://electron.local   (mDNS — may not work on all Android/Windows)'
else
  log '  mDNS off — run once on this PC: npm run lan:setup'
fi
log 'Do not use https://electron.local on other devices unless you install the local CA cert.'
log 'This PC (with /etc/hosts): https://electron.local or https://electron.local:8443'
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
  log 'Firewall active — if LAN fails: sudo ufw allow 80,443/tcp'
fi
log '────────────────────────────────────────────────────────'
