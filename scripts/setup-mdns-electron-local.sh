#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Please run as root (use: sudo $0)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IS_BOARD=0
[[ -f "$ROOT/.forge-board" ]] || [[ "${FORGE_BOARD:-}" == "1" ]] && IS_BOARD=1

if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y avahi-daemon avahi-utils
fi

LAN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)"

# Board: pin electron.local → LAN IP in /etc/hosts (no 127.0.0.1).
# Laptop: leave /etc/hosts alone — keep 127.0.0.1 for you; other devices use mDNS only.
if [[ "$IS_BOARD" -eq 1 ]] && [[ -f /etc/hosts ]]; then
  tmp="$(mktemp)"
  grep -vE '(^|[[:space:]])electron\.local([[:space:]]|$)' /etc/hosts >"$tmp" || true
  if [[ -n "$LAN_IP" ]]; then
    printf '%s electron.local\n' "$LAN_IP" >>"$tmp"
  fi
  cat "$tmp" >/etc/hosts
  rm -f "$tmp"
else
  echo "[lan] Laptop: /etc/hosts unchanged (keep 127.0.0.1 electron.local for this PC if you want)."
fi

# mDNS name electron.local requires hostname "electron" on the LAN.
hostnamectl set-hostname electron

# Avahi: publish electron.local on Wi‑Fi only (not docker0).
mkdir -p /etc/avahi/avahi-daemon.d
if [[ -f "$ROOT/scripts/forge-avahi-host.conf" ]]; then
  cp "$ROOT/scripts/forge-avahi-host.conf" /etc/avahi/avahi-daemon.d/forge-host.conf
fi
if [[ -f "$ROOT/scripts/forge-avahi-wlan-only.conf" ]]; then
  cp "$ROOT/scripts/forge-avahi-wlan-only.conf" /etc/avahi/avahi-daemon.d/forge-wlan-only.conf
fi

systemctl enable --now avahi-daemon || true
systemctl restart avahi-daemon 2>/dev/null || true
sleep 1

echo ""
echo "mDNS configured (PCs / some iPhones):"
echo "  http://electron.local/dashboard"
if [[ -n "$LAN_IP" ]]; then
  echo ""
  echo "Phones (Android): use IP — .local usually does not work in Chrome:"
  echo "  http://${LAN_IP}/dashboard"
  echo ""
  echo "To force electron.local on phone: npm run lan:dns"
  echo "  (phone Wi‑Fi DNS → ${LAN_IP})"
fi
echo ""
echo "Details: npm run lan:mdns-check"
if [[ "$IS_BOARD" -eq 1 ]]; then
  echo ""
  echo "Then: npm run board:go"
else
  echo ""
  echo "Then on this laptop:"
  echo "  npm run caddy:start && npm run caddy:sync"
  echo "  npm run dev"
  echo "See: npm run lan:share"
fi
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
  echo ""
  echo "Firewall: sudo ufw allow 80/tcp"
fi
