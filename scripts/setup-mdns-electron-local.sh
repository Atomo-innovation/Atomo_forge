#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Please run as root (use: sudo $0)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y avahi-daemon avahi-utils
fi

LAN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)"

# Remove bad electron.local lines (127.0.0.1 or stale), then pin LAN IP for this device.
if [[ -f /etc/hosts ]]; then
  tmp="$(mktemp)"
  grep -vE '(^|[[:space:]])electron\.local([[:space:]]|$)' /etc/hosts >"$tmp" || true
  if [[ -n "$LAN_IP" ]]; then
    printf '%s electron.local\n' "$LAN_IP" >>"$tmp"
  fi
  cat "$tmp" >/etc/hosts
  rm -f "$tmp"
fi

hostnamectl set-hostname electron

# Avahi: only publish on Wi‑Fi/Ethernet (not docker0).
mkdir -p /etc/avahi/avahi-daemon.d
if [[ -f "$ROOT/scripts/forge-avahi-wlan-only.conf" ]]; then
  cp "$ROOT/scripts/forge-avahi-wlan-only.conf" /etc/avahi/avahi-daemon.d/forge-board.conf
fi

systemctl enable --now avahi-daemon || true
systemctl restart avahi-daemon 2>/dev/null || true
sleep 1

echo ""
echo "mDNS + /etc/hosts configured for electron.local"
if [[ -n "$LAN_IP" ]]; then
  echo "  This device: http://electron.local  →  $LAN_IP (via /etc/hosts)"
fi
echo "  Other Wi‑Fi devices: http://electron.local  (mDNS on wlan only)"
echo ""
echo "Then run: npm run board:go   (or npm run dev)"
