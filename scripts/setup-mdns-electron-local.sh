#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Please run as root (use: sudo $0)" >&2
  exit 1
fi

if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y avahi-daemon avahi-utils
fi

# IMPORTANT:
# If /etc/hosts contains "electron.local -> 127.0.0.1", other devices will NOT be able
# to reach this machine when they resolve electron.local. Remove any such overrides.
if [[ -f /etc/hosts ]]; then
  # Remove any existing electron.local mappings (idempotent).
  tmp="$(mktemp)"
  grep -vE '(^|[[:space:]])electron\.local([[:space:]]|$)' /etc/hosts > "$tmp" || true
  cat "$tmp" > /etc/hosts
  rm -f "$tmp"
fi

# Publish this machine as: electron.local via mDNS (Avahi advertises <hostname>.local)
hostnamectl set-hostname electron

systemctl enable --now avahi-daemon || true

echo ""
echo "mDNS enabled."
echo "Other devices on the same LAN can open: http://electron.local"
echo ""
echo "Note: HTTPS on other devices requires trusting your local CA certificate."

