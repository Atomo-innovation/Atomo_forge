#!/usr/bin/env bash
# Optional: resolve electron.local on phones via DNS (not mDNS).
# Phone Wi‑Fi → DNS = this laptop's LAN IP (manual).
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run: npm run lan:dns  (uses sudo)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAN_IP="$(node "$ROOT/scripts/forge-network.cjs" 2>/dev/null || ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"

if [[ -z "$LAN_IP" ]]; then
  echo "No LAN IP — connect Wi‑Fi first." >&2
  exit 1
fi

if command -v apt-get >/dev/null 2>&1; then
  apt-get install -y dnsmasq
fi

mkdir -p /etc/dnsmasq.d
cat >/etc/dnsmasq.d/forge-electron-local.conf <<EOF
# Forge dev: electron.local → this machine (for phones that cannot use mDNS)
interface=wlo1,wlan0,eth0,enp0s31f6,enp1s0
bind-interfaces
listen-address=${LAN_IP}
listen-address=127.0.0.1
address=/electron.local/${LAN_IP}
no-resolv
EOF

systemctl enable dnsmasq 2>/dev/null || true
systemctl restart dnsmasq

echo ""
echo "DNS server on ${LAN_IP} — electron.local → ${LAN_IP}"
echo ""
echo "On the PHONE (same Wi‑Fi):"
echo "  1. Wi‑Fi settings → this network → DNS → Manual"
echo "  2. DNS server: ${LAN_IP}   (only this one, or put it first)"
echo "  3. Browser: http://electron.local/dashboard"
echo ""
echo "Revert phone DNS to Automatic when done."
echo "Keep npm run dev running on this laptop."
echo ""
