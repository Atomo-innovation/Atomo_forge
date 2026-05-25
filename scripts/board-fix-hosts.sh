#!/usr/bin/env bash
# Fix electron.local on the board: remove wrong /etc/hosts lines, pin LAN IP for this device.
# Run: npm run board:fix-hosts
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run: npm run board:fix-hosts   (uses sudo)" >&2
  exit 1
fi

LAN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)"
if [[ -z "$LAN_IP" ]]; then
  echo "[board] Could not detect LAN IP" >&2
  exit 1
fi

tmp="$(mktemp)"
if [[ -f /etc/hosts ]]; then
  grep -vE '(^|[[:space:]])electron\.local([[:space:]]|$)' /etc/hosts >"$tmp" || true
else
  : >"$tmp"
fi
printf '%s electron.local\n' "$LAN_IP" >>"$tmp"
cat "$tmp" >/etc/hosts
rm -f "$tmp"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p /etc/avahi/avahi-daemon.d
if [[ -f "$ROOT/scripts/forge-avahi-wlan-only.conf" ]]; then
  cp "$ROOT/scripts/forge-avahi-wlan-only.conf" /etc/avahi/avahi-daemon.d/forge-board.conf
fi
systemctl restart avahi-daemon 2>/dev/null || true
sleep 1

echo "[board] /etc/hosts: electron.local → $LAN_IP"
echo "[board] Avahi: publishing on Wi‑Fi only (not Docker)."
echo "[board] Test: getent hosts electron.local"
getent hosts electron.local 2>/dev/null || true
echo "[board] Next: npm run board:caddy-sync && npm run board:go"
